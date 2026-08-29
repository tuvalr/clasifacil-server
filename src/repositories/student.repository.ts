import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { Student, StudentEntity } from '../entities/student.entity';

@injectable()
export class StudentRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByHouseholdId(householdId: number): Promise<Student[]> {
		return this.db.queryActive(StudentEntity, 'household_id = $1', [householdId]);
	}

	public async findById(id: number): Promise<Student | null> {
		return this.db.findById(StudentEntity, id);
	}

	public async create(data: { householdId: number; fullName: string; dateOfBirth: Date | null; notes: string | null }): Promise<Student> {
		return this.db.insert(StudentEntity, { ...data, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ fullName: string; dateOfBirth: Date | null; notes: string | null }>): Promise<Student | null> {
		return this.db.update(StudentEntity, id, data);
	}

	public async archive(id: number): Promise<void> {
		return this.db.delete(StudentEntity, id);
	}

	public async restore(id: number): Promise<void> {
		return this.db.unDelete(StudentEntity, id);
	}
}
