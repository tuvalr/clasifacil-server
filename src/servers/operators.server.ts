import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../services/postgres-handler';
import { OperatorRepository } from '../repositories/operator.repository';
import { UserRepository } from '../repositories/user.repository';
import { Operator } from '../entities/operator.entity';
import { User } from '../entities/user.entity';

// Admin: creating and managing operators.
@injectable()
export class OperatorsServer {
	public constructor(
		@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.UserRepository) private readonly users: UserRepository,
	) {}

	public async listAll(): Promise<Operator[]> {
		return this.operators.findAll();
	}

	public async findById(id: number): Promise<Operator | null> {
		return this.operators.findById(id);
	}

	// Creates the operators row and its login-capable users row (role:
	// 'operator', associatedEntityId: the new operator's id) together —
	// if either insert fails, both roll back, so an operator can never be
	// left without a way to log in.
	//
	// TODO: create Auth user with authUid and email, and ensure that the
	// authUid is unique (i.e., not already in use by another user). If
	// the Auth user creation fails, we should not create the operator or
	// user rows in the database.
	public async create(data: { name: string; email: string; authUid: string }): Promise<{ operator: Operator; user: User }> {
		return this.db.transaction(async (transaction: TransactionHandle) => {
			const operator = await this.operators.create({ name: data.name, email: data.email }, transaction);
			const user = await this.users.create({ authUid: data.authUid, email: data.email, role: 'operator', associatedEntityId: operator.id }, transaction);
			return { operator, user };
		});
	}
}
