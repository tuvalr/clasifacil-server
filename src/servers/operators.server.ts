import { randomUUID } from 'crypto';
import { isValidPhoneNumber, getCountries, CountryCode } from 'libphonenumber-js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { OperatorRepository } from '../repositories/operator.repository';
import { UserRepository } from '../repositories/user.repository';
import { Operator } from '../entities/operator.entity';
import { User } from '../entities/user.entity';

export interface ValidationErrorDetail {
	field: string;
	message: string;
}

export class ValidationError extends Error {
	public constructor(public readonly details: ValidationErrorDetail[]) {
		super('Validation failed');
		this.name = 'ValidationError';
	}
}

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

	// Creates the operators row and its login-capable users row (role:
	// 'operator', associatedEntityId: the new operator's id) together —
	// if either insert fails, both roll back, so an operator can never be
	// left without a way to log in. auth_uid is generated here (not
	// accepted from the client) since it's a uuid-typed, unique login
	// identifier — the caller has no business choosing it.
	public async create(data: { name: string; email: string; phone: string; countryCode: string }): Promise<{ operator: Operator; user: User }> {
		const details = await this.validate(data);
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

	private async validate(data: { name: string; email: string; phone: string; countryCode: string }): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		if (!EMAIL_PATTERN.test(data.email)) {
			details.push({ field: 'email', message: 'Invalid email format' });
		} else if (await this.operators.findByEmail(data.email)) {
			details.push({ field: 'email', message: 'An operator with this email already exists' });
		}

		if (await this.operators.findByName(data.name)) {
			details.push({ field: 'name', message: 'An operator with this name already exists' });
		}

		if (!isKnownCountryCode(data.countryCode)) {
			details.push({ field: 'countryCode', message: 'Invalid or unrecognized country code' });
		} else if (!isValidPhoneNumber(data.phone, data.countryCode)) {
			details.push({ field: 'phone', message: `Invalid phone number for country code ${data.countryCode}` });
		}

		return details;
	}
}
