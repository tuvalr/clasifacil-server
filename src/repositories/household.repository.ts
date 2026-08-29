import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../services/postgres-handler';
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

	public async create(data: { name: string; email: string }): Promise<Household> {
		return this.db.insert(HouseholdEntity, { name: data.name, email: data.email, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ name: string; email: string }>): Promise<Household | null> {
		return this.db.update(HouseholdEntity, id, data);
	}

	public async archive(id: number): Promise<void> {
		return this.db.delete(HouseholdEntity, id);
	}

	public async restore(id: number): Promise<void> {
		return this.db.unDelete(HouseholdEntity, id);
	}
}
