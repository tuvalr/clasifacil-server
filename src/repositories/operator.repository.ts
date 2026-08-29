import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../services/postgres-handler';
import { Operator, OperatorEntity } from '../entities/operator.entity';

@injectable()
export class OperatorRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findAll(): Promise<Operator[]> {
		return this.db.queryActive(OperatorEntity);
	}

	public async findById(id: number): Promise<Operator | null> {
		return this.db.findById(OperatorEntity, id);
	}

	// Accepts an optional TransactionHandle — see UserRepository.create()
	// for why (AdminOperatorsController creates an operator + its user
	// account atomically).
	public async create(data: { name: string; email: string }, tx?: TransactionHandle): Promise<Operator> {
		const db = tx ?? this.db;
		return db.insert(OperatorEntity, { ...data, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ name: string; email: string; stripeAccountId: string | null; onboardingStatus: string | null }>): Promise<Operator | null> {
		return this.db.update(OperatorEntity, id, data);
	}
}
