import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../services/postgres-handler';
import { Operator, OperatorEntity } from '../entities/operator.entity';

@injectable()
export class OperatorRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findById(id: number): Promise<Operator | null> {
		return this.db.findById(OperatorEntity, id);
	}

	public async update(id: number, data: Partial<{ name: string; email: string; stripeAccountId: string | null; onboardingStatus: string | null }>): Promise<Operator | null> {
		return this.db.update(OperatorEntity, id, data);
	}
}
