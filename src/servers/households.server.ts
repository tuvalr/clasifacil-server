import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { HouseholdRepository } from '../repositories/household.repository';
import { StudentRepository } from '../repositories/student.repository';
import { Household } from '../entities/household.entity';
import { Student } from '../entities/student.entity';

// UC1: Household & Multi-Child Account Management. Operations for both
// the operator (list/archive/restore) and parent (get/update/manage own
// students) roles live together here since they operate on the same
// households/students data.
@injectable()
export class HouseholdsServer {
	public constructor(
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
	) {}

	// Operator-side

	public async listAll(): Promise<Household[]> {
		return this.households.findAll();
	}

	public async archive(id: number): Promise<void> {
		await this.households.archive(id);
	}

	public async restore(id: number): Promise<void> {
		await this.households.restore(id);
	}

	// TODO: requires a co-parent/secondary-adult table (PRD UC1: "grant
	// secondary view/booking access to a co-parent via email invite") —
	// no such table exists yet.

	// Parent-side

	public async getById(id: number): Promise<Household | null> {
		return this.households.findById(id);
	}

	public async update(id: number, data: { name?: string; email?: string }): Promise<Household | null> {
		return this.households.update(id, data);
	}

	public async listStudents(householdId: number): Promise<Student[]> {
		return this.students.findByHouseholdId(householdId);
	}

	public async createStudent(data: { householdId: number; fullName: string; dateOfBirth: Date | null; notes: string | null }): Promise<Student> {
		return this.students.create(data);
	}

	public async updateStudent(studentId: number, data: { fullName?: string; notes?: string | null }): Promise<Student | null> {
		return this.students.update(studentId, data);
	}

	// PRD UC1 edge case: "Archiving a Child Profile" — retain historical
	// attendance/invoice logs, remove from active roster selectors. This
	// is exactly PostgresHandler's soft-delete, so it IS implemented.
	public async archiveStudent(studentId: number): Promise<void> {
		await this.students.archive(studentId);
	}
}
