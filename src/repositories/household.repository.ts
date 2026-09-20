import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { Household, HouseholdEntity } from '../entities/household.entity';

@injectable()
export class HouseholdRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findAll(): Promise<Household[]> {
		return this.db.queryActive(HouseholdEntity);
	}

	public async findById(id: number): Promise<Household | null> {
		return this.db.findById(HouseholdEntity, id);
	}

	// Ignores is_deleted - used to check existence before restoring an archived household.
	public async findByIdIgnoringDeleted(id: number): Promise<Household | null> {
		return this.db.findByIdIgnoringDeleted(HouseholdEntity, id);
	}

	public async findByName(name: string): Promise<Household | null> {
		const rows = await this.db.queryActive(HouseholdEntity, 'name = $1', [name]);
		return rows[0] ?? null;
	}

	public async findByEmail(email: string): Promise<Household | null> {
		const rows = await this.db.queryActive(HouseholdEntity, 'email = $1', [email]);
		return rows[0] ?? null;
	}

	// Accepts an optional TransactionHandle - see UserRepository.create() for why (AdminController creates a
	// household + its household user account atomically).
	public async create(data: { name: string; email: string }, tx?: TransactionHandle): Promise<Household> {
		const db = tx ?? this.db;
		return db.insert(HouseholdEntity, { name: data.name, email: data.email, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ name: string; email: string; avatarUrl: string | null }>): Promise<Household | null> {
		return this.db.update(HouseholdEntity, id, data);
	}

	public async pause(id: number, pausedUntil: Date | null): Promise<Household | null> {
		return this.db.update(HouseholdEntity, id, { status: 'paused', pausedUntil });
	}

	public async resume(id: number): Promise<Household | null> {
		return this.db.update(HouseholdEntity, id, { status: 'active', pausedUntil: null });
	}

	public async archive(id: number, tx?: TransactionHandle): Promise<void> {
		const db = tx ?? this.db;
		return db.delete(HouseholdEntity, id);
	}

	public async restore(id: number): Promise<void> {
		return this.db.unDelete(HouseholdEntity, id);
	}
}
