import { randomUUID } from 'crypto';
import { isValidPhoneNumber, getCountries, CountryCode } from 'libphonenumber-js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { OperatorRepository } from '../repositories/operator.repository';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { StudentRepository } from '../repositories/student.repository';
import { HouseholdRepository } from '../repositories/household.repository';
import { Operator } from '../entities/operator.entity';
import { User } from '../entities/user.entity';
import { Session } from '../entities/session.entity';
import { EnrollmentAndCredit } from '../entities/enrollment-and-credit.entity';
import { Student } from '../entities/student.entity';
import { Household } from '../entities/household.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';

export class OperatorHasActiveClassesError extends Error {
	public constructor() {
		super('Cannot change operator type while active classes exist');
		this.name = 'OperatorHasActiveClassesError';
	}
}

export class OperatorTimezoneLockedError extends Error {
	public constructor() {
		super('Cannot change timezone once the operator has any class — contact an admin for manual correction');
		this.name = 'OperatorTimezoneLockedError';
	}
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_COUNTRY_CODES: ReadonlySet<string> = new Set(getCountries());
const VALID_TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

function isKnownCountryCode(value: string): value is CountryCode {
	return VALID_COUNTRY_CODES.has(value);
}

export type EnrollmentWithHouseholdDetails = EnrollmentAndCredit & { student: Student | null; household: Household | null };
export type SessionWithEnrollmentDetails = Session & { enrollments: EnrollmentWithHouseholdDetails[] };

// Admin: creating and managing operators.
@injectable()
export class OperatorsServer {
	public constructor(
		@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.UserRepository) private readonly users: UserRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
	) {}

	public async listAll(): Promise<Operator[]> {
		return this.operators.findAll();
	}

	public async findById(id: number): Promise<Operator | null> {
		return this.operators.findById(id);
	}

	// Detail view: the operator plus each of its (non-cancelled) sessions, each annotated with its own
	// enrollments — and each enrollment annotated with the student and household that booked it — everything an
	// admin needs to see who is connected to this operator without further round trips. Students/households are
	// fetched once per distinct id (not once per enrollment) since the same household commonly has multiple
	// students/enrollments across an operator's sessions.
	public async getByIdWithDetails(id: number): Promise<{ operator: Operator; sessions: SessionWithEnrollmentDetails[] } | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}

		const sessions = await this.sessions.findByOperatorId(id);
		const enrollmentsBySession = await Promise.all(sessions.map((session: Session) => this.enrollments.findBySessionId(session.id)));
		const allEnrollments = enrollmentsBySession.flat();

		const studentIds = [...new Set(allEnrollments.map((enrollment: EnrollmentAndCredit) => enrollment.studentId))];
		const householdIds = [...new Set(allEnrollments.map((enrollment: EnrollmentAndCredit) => enrollment.householdId))];
		const [studentResults, householdResults]: [(Student | null)[], (Household | null)[]] = await Promise.all([
			Promise.all(studentIds.map((studentId: number) => this.students.findById(studentId))),
			Promise.all(householdIds.map((householdId: number) => this.households.findById(householdId))),
		]);
		const studentsById = new Map<number, Student>(
			studentResults.filter((student: Student | null): student is Student => student !== null).map((student: Student) => [student.id, student]),
		);
		const householdsById = new Map<number, Household>(
			householdResults.filter((household: Household | null): household is Household => household !== null).map((household: Household) => [household.id, household]),
		);

		return {
			operator,
			sessions: sessions.map((session: Session, index: number) => ({
				...session,
				enrollments: enrollmentsBySession[index].map((enrollment: EnrollmentAndCredit) => ({
					...enrollment,
					student: studentsById.get(enrollment.studentId) ?? null,
					household: householdsById.get(enrollment.householdId) ?? null,
				})),
			})),
		};
	}

	// Creates the operators row and its login-capable users row (role: 'operator', associatedEntityId: the new operator's id) together —
	// if either insert fails, both roll back, so an operator can never be left without a way to log in. auth_uid is generated here (not
	// accepted from the client) since it's a uuid-typed, unique login identifier — the caller has no business choosing it.
	public async create(data: {
		name: string;
		email: string;
		phone: string;
		countryCode: string;
		type: 'schedule' | 'assigned';
		timezone: string;
	}): Promise<{ operator: Operator; user: User }> {
		const details = await this.validateCreate(data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		const authUid = randomUUID();

		return this.db.transaction(async (transaction: TransactionHandle) => {
			const operator = await this.operators.create(
				{ name: data.name, email: data.email, phone: data.phone, countryCode: data.countryCode, type: data.type, timezone: data.timezone },
				transaction,
			);
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

	// Blocked while the operator has any active (non-deleted) classes, regardless of pause status — switching
	// scheduling model out from under a live recurring class would orphan its occurrences/roster semantics.
	// hasActiveClasses is injected as a callback (rather than this server depending on ClassesServer directly) to
	// avoid a circular dependency between operators.server.ts and classes.server.ts — Task 2 wires the real check.
	public async changeType(id: number, type: 'schedule' | 'assigned', hasActiveClasses: (operatorId: number) => Promise<boolean>): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}
		if (await hasActiveClasses(id)) {
			throw new OperatorHasActiveClassesError();
		}
		return this.operators.updateType(id, type);
	}

	// findById first — same reasoning as pause()/resume(): update() has no is_deleted guard, so without this check a
	// soft-deleted operator would still match and get silently updated instead of 404ing like every other endpoint.
	// hasAnyClass is injected as a callback (rather than this server depending on ClassRepository directly) to avoid
	// a circular dependency between operators.server.ts and classes.server.ts — same pattern as changeType's
	// hasActiveClasses callback.
	public async update(
		id: number,
		data: { name?: string; email?: string; phone?: string; countryCode?: string; timezone?: string },
		hasAnyClass: (operatorId: number) => Promise<boolean>,
	): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}

		if (data.timezone !== undefined && data.timezone !== operator.timezone && (await hasAnyClass(id))) {
			throw new OperatorTimezoneLockedError();
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

	private async validateCreate(data: { name: string; email: string; phone: string; countryCode: string; type?: unknown; timezone?: unknown }): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		// Validate type is present and valid
		if (data.type === undefined) {
			details.push({ field: 'type', message: 'type is required' });
			return details;
		}
		if (data.type !== 'schedule' && data.type !== 'assigned') {
			details.push({ field: 'type', message: "type must be 'schedule' or 'assigned'" });
			return details;
		}

		if (data.timezone === undefined) {
			details.push({ field: 'timezone', message: 'timezone is required' });
		} else {
			details.push(...this.validateTimezone(data.timezone));
		}

		details.push(...(await this.validateEmail(data.email, null)));
		details.push(...(await this.validateName(data.name, null)));
		details.push(...(await this.validatePhone(data.phone, null, data.countryCode)));

		return details;
	}

	// Only the fields actually present in `data` are checked — an update() caller that isn't touching name/email/phone
	// shouldn't be blocked by, say, another operator already having this operator's own unchanged email.
	private async validateUpdate(id: number, data: { name?: string; email?: string; phone?: string; countryCode?: string; timezone?: string }): Promise<ValidationErrorDetail[]> {
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
		if (data.timezone !== undefined) {
			details.push(...this.validateTimezone(data.timezone));
		}

		return details;
	}

	// Checked against the runtime's actual IANA timezone database (Intl.supportedValuesOf('timeZone')) rather than
	// a hand-maintained list, so it stays correct as the underlying tzdata updates — same "validate at the
	// application layer, not a raw DB error" reasoning as validatePhone's countryCode check.
	private validateTimezone(timezone: unknown): ValidationErrorDetail[] {
		if (typeof timezone !== 'string' || !VALID_TIMEZONES.has(timezone)) {
			return [{ field: 'timezone', message: 'Invalid or unrecognized IANA timezone name' }];
		}
		return [];
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
