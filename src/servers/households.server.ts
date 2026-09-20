import { randomUUID } from 'crypto';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { HouseholdRepository } from '../repositories/household.repository';
import { StudentRepository } from '../repositories/student.repository';
import { UserRepository } from '../repositories/user.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { Household } from '../entities/household.entity';
import { Student } from '../entities/student.entity';
import { User } from '../entities/user.entity';
import { EnrollmentAndCredit } from '../entities/enrollment-and-credit.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Household is "connected to an operator" once any of its students holds a live ('booked') enrollment in one of
// that operator's sessions - deleting the household out from under an active booking would orphan it.
export class HouseholdHasActiveBookingError extends Error {
	public constructor() {
		super('Cannot delete a household with an active booking');
		this.name = 'HouseholdHasActiveBookingError';
	}
}

// UC1: Household & Multi-Student Account Management. Operations for both
// the operator (list/archive/restore) and household (get/update/manage own
// students) roles live together here since they operate on the same
// households/students data.
@injectable()
export class HouseholdsServer {
	public constructor(
		@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler,
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
		@inject(TYPES.UserRepository) private readonly users: UserRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
	) {}

	// Operator-side

	public async listAll(): Promise<Household[]> {
		return this.households.findAll();
	}

	public async archive(id: number): Promise<Household | null> {
		const household = await this.households.findById(id);
		if (!household) {
			return null;
		}
		await this.households.archive(id);
		return household;
	}

	public async restore(id: number): Promise<Household | null> {
		const household = await this.households.findByIdIgnoringDeleted(id);
		if (!household) {
			return null;
		}
		await this.households.restore(id);
		return household;
	}

	// Admin-side

	// Detail view: the household plus each of its (non-archived) students, each annotated with their own
	// enrollments - everything an admin needs to see a household's standing (including its connections to
	// operators via booked sessions) without further round trips. Fetches all of the household's enrollments once
	// and groups them by studentId rather than querying per student.
	public async getByIdWithDetails(id: number): Promise<{ household: Household; students: (Student & { enrollments: EnrollmentAndCredit[] })[] } | null> {
		const household = await this.households.findById(id);
		if (!household) {
			return null;
		}

		const [students, enrollments]: [Student[], EnrollmentAndCredit[]] = await Promise.all([this.students.findByHouseholdId(id), this.enrollments.findByHouseholdId(id)]);

		const enrollmentsByStudentId = new Map<number, EnrollmentAndCredit[]>();
		for (const enrollment of enrollments) {
			const existing = enrollmentsByStudentId.get(enrollment.studentId) ?? [];
			existing.push(enrollment);
			enrollmentsByStudentId.set(enrollment.studentId, existing);
		}

		return {
			household,
			students: students.map((student: Student) => ({ ...student, enrollments: enrollmentsByStudentId.get(student.id) ?? [] })),
		};
	}

	// Creates the households row and its login-capable users row (role: 'household', associatedEntityId: the new
	// household's id) together - same atomicity reasoning as OperatorsServer.create(): if either insert fails, both
	// roll back, so a household can never be left without a way to log in.
	public async create(data: { name: string; email: string }): Promise<{ household: Household; user: User }> {
		const details = await this.validateCreate(data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		const authUid = randomUUID();

		return this.db.transaction(async (transaction: TransactionHandle) => {
			const household = await this.households.create({ name: data.name, email: data.email }, transaction);
			const user = await this.users.create({ authUid, email: data.email, role: 'household', associatedEntityId: household.id }, transaction);
			return { household, user };
		});
	}

	// Soft-deletes the household and its login-capable users row together - refuses if the household currently has
	// any active ('booked') enrollment in an operator's session, so a live booking can never be orphaned by deletion.
	public async delete(id: number): Promise<Household | null> {
		const household = await this.households.findById(id);
		if (!household) {
			return null;
		}

		if (await this.enrollments.existsActiveBookingForHousehold(id)) {
			throw new HouseholdHasActiveBookingError();
		}

		await this.db.transaction(async (transaction: TransactionHandle) => {
			await this.households.archive(id, transaction);
			const user = await this.users.findByAssociatedEntity('household', id);
			if (user) {
				await this.users.delete(user.id, transaction);
			}
		});

		return household;
	}

	// findById first (rather than trusting pause()'s own UPDATE...RETURNING) because that UPDATE has no is_deleted
	// guard - without this check, a soft-deleted household would still match and get silently paused/resumed
	// instead of 404ing like every other endpoint.
	public async pause(id: number, pausedUntil: Date | null): Promise<Household | null> {
		const household = await this.households.findById(id);
		if (!household) {
			return null;
		}
		return this.households.pause(id, pausedUntil);
	}

	public async resume(id: number): Promise<Household | null> {
		const household = await this.households.findById(id);
		if (!household) {
			return null;
		}
		return this.households.resume(id);
	}

	private async validateCreate(data: { name: string; email: string }): Promise<ValidationErrorDetail[]> {
		const details: ValidationErrorDetail[] = [];

		if (!EMAIL_PATTERN.test(data.email)) {
			details.push({ field: 'email', message: 'Invalid email format' });
		} else {
			const existingHousehold = await this.households.findByEmail(data.email);
			if (existingHousehold) {
				details.push({ field: 'email', message: 'A household with this email already exists' });
			} else {
				const existingUser = await this.users.findByEmail(data.email);
				if (existingUser) {
					details.push({ field: 'email', message: 'An account with this email already exists' });
				}
			}
		}

		const existingName = await this.households.findByName(data.name);
		if (existingName) {
			details.push({ field: 'name', message: 'A household with this name already exists' });
		}

		return details;
	}

	// TODO: requires a co-household-owner/secondary-adult table (PRD UC1: "grant
	// secondary view/booking access to a co-household-owner via email invite") -
	// no such table exists yet.

	// Household-side

	public async getById(id: number): Promise<Household | null> {
		return this.households.findById(id);
	}

	public async update(id: number, data: { name?: string; email?: string }): Promise<Household | null> {
		return this.households.update(id, data);
	}

	public async updateAvatarUrl(id: number, avatarUrl: string | null): Promise<Household | null> {
		return this.households.update(id, { avatarUrl });
	}

	public async listStudents(householdId: number): Promise<Student[] | null> {
		const household = await this.households.findById(householdId);
		if (!household) {
			return null;
		}
		return this.students.findByHouseholdId(householdId);
	}

	public async createStudent(data: { householdId: number; fullName: string; dateOfBirth: Date | null; notes: string | null }): Promise<Student | null> {
		const household = await this.households.findById(data.householdId);
		if (!household) {
			return null;
		}
		return this.students.create(data);
	}

	public async updateStudent(studentId: number, data: { fullName?: string; notes?: string | null }): Promise<Student | null> {
		return this.students.update(studentId, data);
	}

	// PRD UC1 edge case: "Archiving a Student Profile" - retain historical
	// attendance/invoice logs, remove from active roster selectors. This
	// is exactly PostgresHandler's soft-delete, so it IS implemented.
	public async archiveStudent(studentId: number): Promise<Student | null> {
		const student = await this.students.findById(studentId);
		if (!student) {
			return null;
		}
		await this.students.archive(studentId);
		return student;
	}
}
