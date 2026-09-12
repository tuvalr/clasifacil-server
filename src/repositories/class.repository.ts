import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { Class, ClassEntity } from '../entities/class.entity';

@injectable()
export class ClassRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByOperatorId(operatorId: number): Promise<Class[]> {
		return this.db.queryActive(ClassEntity, 'operator_id = $1', [operatorId]);
	}

	public async findById(id: number): Promise<Class | null> {
		return this.db.findById(ClassEntity, id);
	}

	public async create(
		data: { operatorId: number; title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number },
		tx?: TransactionHandle,
	): Promise<Class> {
		const db = tx ?? this.db;
		return db.insert(ClassEntity, { ...data, isDeleted: false });
	}

	public async update(
		id: number,
		data: Partial<{ title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number }>,
	): Promise<Class | null> {
		return this.db.update(ClassEntity, id, data);
	}

	public async pause(id: number, pausedUntil: Date | null): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'paused', pausedUntil });
	}

	public async resume(id: number): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'active', pausedUntil: null });
	}

	public async archive(id: number): Promise<void> {
		return this.db.delete(ClassEntity, id);
	}

	// Stubbed until Task 3 adds class_enrollments — always reports no active enrollments, so class delete and
	// operator change-type are never blocked yet. Task 3 replaces the query body with a real count against
	// class_enrollments (status = 'active').
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- classId will be used once the real query lands in Task 3
	public existsActiveEnrollments(classId: number): Promise<boolean> {
		return Promise.resolve(false);
	}

	public async existsActiveForOperator(operatorId: number): Promise<boolean> {
		const rows = await this.db.queryActive(ClassEntity, 'operator_id = $1', [operatorId]);
		return rows.length > 0;
	}
}
