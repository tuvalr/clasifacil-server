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

	// Every non-stopped class across all operators, regardless of operator.type (schedule or recurring
	// assigned) - used by the nightly backfill job, which applies uniformly per the spec (maxSize only affects
	// roster capacity, never derivation).
	public async findAllActive(): Promise<Class[]> {
		return this.db.queryActive(ClassEntity, "status = 'active'");
	}

	public async findById(id: number): Promise<Class | null> {
		return this.db.findById(ClassEntity, id);
	}

	public async create(data: { operatorId: number; title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number; color: string | null }, tx?: TransactionHandle): Promise<Class> {
		const db = tx ?? this.db;
		return db.insert(ClassEntity, { ...data, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number; color: string | null }>): Promise<Class | null> {
		return this.db.update(ClassEntity, id, data);
	}

	public async stop(id: number): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'stopped', stoppedAt: new Date() });
	}

	public async unstop(id: number): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'active', stoppedAt: null });
	}

	public async archive(id: number): Promise<void> {
		return this.db.delete(ClassEntity, id);
	}

	public async existsActiveForOperator(operatorId: number): Promise<boolean> {
		const rows = await this.db.queryActive(ClassEntity, 'operator_id = $1', [operatorId]);
		return rows.length > 0;
	}

	// Unlike every other query in this repository, deliberately ignores is_deleted - used only to decide whether an
	// operator's timezone may still be changed. Once any class has ever existed for this operator (even one since
	// soft-deleted), its historical sessions/occurrences were already computed under the operator's timezone at the
	// time, so the timezone must not change afterward (see OperatorsServer.update's timezone-lock guard).
	public async existsAnyForOperator(operatorId: number): Promise<boolean> {
		const rows = await this.db.query<{ count: string }>('SELECT COUNT(*) AS count FROM "classes" WHERE operator_id = $1', [operatorId]);
		return Number(rows[0]?.count ?? 0) > 0;
	}
}
