import { randomUUID } from 'crypto';
import { isValidPhoneNumber, getCountries, CountryCode } from 'libphonenumber-js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { OperatorRepository } from '../repositories/operator.repository';
import { UserRepository } from '../repositories/user.repository';
import { Operator } from '../entities/operator.entity';
import { User } from '../entities/user.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_COUNTRY_CODES: ReadonlySet<string> = new Set(getCountries());

function isKnownCountryCode(value: string): value is CountryCode {
	return VALID_COUNTRY_CODES.has(value);
}

// Admin: creating and managing operators.
@injectable()
export class OperatorsServer {
	public constructor(
		@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.UserRepository) private readonly users: UserRepository,
	) {}

	public async listAll(): Promise<Operator[]> {
		return this.operators.findAll();
	}

	public async findById(id: number): Promise<Operator | null> {
		return this.operators.findById(id);
	}

	// Creates the operators row and its login-capable users row (role: 'operator', associatedEntityId: the new operator's id) together —
	// if either insert fails, both roll back, so an operator can never be left without a way to log in. auth_uid is generated here (not
	// accepted from the client) since it's a uuid-typed, unique login identifier — the caller has no business choosing it.
	public async create(data: { name: string; email: string; phone: string; countryCode: string }): Promise<{ operator: Operator; user: User }> {
		const details = await this.validateCreate(data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		const authUid = randomUUID();

		return this.db.transaction(async (transaction: TransactionHandle) => {
			const operator = await this.operators.create({ name: data.name, email: data.email, phone: data.phone, countryCode: data.countryCode }, transaction);
			const user = await this.users.create({ authUid, email: data.email, role: 'operator', associatedEntityId: operator.id }, transaction);
			return { operator, user };
		});
	}

	// Soft-deletes the operator and its login-capable users row together — same atomicity reasoning as create(): a deleted operator must
	// immediately lose the ability to log in, so both rows go together or neither does.
	public async delete(id: number): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}

		await this.db.transaction(async (transaction: TransactionHandle) => {
			await this.operators.delete(id, transaction);
			const user = await this.users.findByAssociatedEntity('operator', id);
			if (user) {
				await this.users.delete(user.id, transaction);
			}
		});

		return operator;
	}

	// pausedUntil: null means an unlimited (indefinite) pause; a date means the operator is paused until that time.
	// Resuming is always an explicit call (resume()) — pausedUntil is not auto-expired on read.
	// findById first (rather than trusting pause()'s own UPDATE...RETURNING) because that UPDATE has no is_deleted guard — without this
	// check, a soft-deleted operator would still match and get silently paused/resumed instead of 404ing like every other endpoint.
	public async pause(id: number, pausedUntil: Date | null): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}
		return this.operators.pause(id, pausedUntil);
	}

	public async resume(id: number): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}
		return this.operators.resume(id);
	}

	// findById first — same reasoning as pause()/resume(): update() has no is_deleted guard, so without this check a
	// soft-deleted operator would still match and get silently updated instead of 404ing like every other endpoint.
	public async update(id: number, data: { name?: string; email?: string; phone?: string; countryCode?: string }): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}

		const details = await this.validateUpdate(id, data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		return this.operators.update(id, data);
	}

	public async updateAvatarUrl(id: number, avatarUrl: string | null): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}
		return this.operators.update(id, { avatarUrl });
	}

	private async validateCreate(data: { name: string; email: string; phone: string; countryCode: string }): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		details.push(...(await this.validateEmail(data.email, null)));
		details.push(...(await this.validateName(data.name, null)));
		details.push(...(await this.validatePhone(data.phone, null, data.countryCode)));

		return details;
	}

	// Only the fields actually present in `data` are checked — an update() caller that isn't touching name/email/phone
	// shouldn't be blocked by, say, another operator already having this operator's own unchanged email.
	private async validateUpdate(id: number, data: { name?: string; email?: string; phone?: string; countryCode?: string }): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		if (data.email !== undefined) {
			details.push(...(await this.validateEmail(data.email, id)));
		}
		if (data.name !== undefined) {
			details.push(...(await this.validateName(data.name, id)));
		}
		if (data.phone !== undefined) {
			details.push(...(await this.validatePhone(data.phone, id, data.countryCode)));
		}

		return details;
	}

	// excludeId: a re-fetched match is the operator's own current row (the field is unchanged) rather than a genuine
	// collision — pass the operator's own id on update so it doesn't flag against itself; null on create, where no
	// such row can exist yet. Shared by validateCreate/validateUpdate so both stay consistent automatically.
	//
	// Both operators_email_active_key and users_email_active_key are partial unique indexes scoped to active
	// (NOT is_deleted) rows, so a soft-deleted operator's email is free to reuse — findByEmail/existsByEmail already
	// only see active rows, matching that scope exactly, with no separate ignoring-deleted lookup needed.
	private async validateEmail(email: string, excludeId: number | null): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		if (!EMAIL_PATTERN.test(email)) {
			details.push({ field: 'email', message: 'Invalid email format' });
			return details;
		}

		const existingOperator = await this.operators.findByEmail(email);
		if (existingOperator && existingOperator.id !== excludeId) {
			details.push({ field: 'email', message: 'An operator with this email already exists' });
			return details;
		}

		// users_email_active_key is a separate index (not scoped to operators) — checked independently so a taken
		// login email 400s here instead of reaching that constraint raw. Only checked when the operators check above
		// didn't already flag it, to avoid reporting the same email as invalid twice. Excluded by the *user's*
		// associatedEntityId (not the operator match above, which already returned) — on an unchanged-email update,
		// the operator's own login account legitimately owns this email already.
		const existingUser = await this.users.findByEmail(email);
		if (existingUser && !(existingUser.role === 'operator' && existingUser.associatedEntityId === excludeId)) {
			details.push({ field: 'email', message: 'An account with this email already exists' });
		}

		return details;
	}

	private async validateName(name: string, excludeId: number | null): Promise<ValidationErrorDetail[]> {
		const existing = await this.operators.findByName(name);
		if (existing && existing.id !== excludeId) {
			return [{ field: 'name', message: 'An operator with this name already exists' }];
		}
		return [];
	}

	// countryCode is required on create (format is only checkable together with it) but optional on update — a
	// phone-only update's uniqueness check doesn't also need to re-validate format against a countryCode the caller
	// isn't changing.
	private async validatePhone(phone: string, excludeId: number | null, countryCode?: string): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		if (countryCode !== undefined) {
			if (!isKnownCountryCode(countryCode)) {
				details.push({ field: 'countryCode', message: 'Invalid or unrecognized country code' });
				return details;
			}
			if (!isValidPhoneNumber(phone, countryCode)) {
				details.push({ field: 'phone', message: `Invalid phone number for country code ${countryCode}` });
				return details;
			}
		}

		const existing = await this.operators.findByPhone(phone);
		if (existing && existing.id !== excludeId) {
			details.push({ field: 'phone', message: 'An operator with this phone number already exists' });
		}

		return details;
	}
}
