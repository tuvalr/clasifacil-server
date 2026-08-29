import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../services/postgres-handler';
import { User, UserEntity } from '../entities/user.entity';

@injectable()
export class UserRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findById(id: number): Promise<User | null> {
		return this.db.findById(UserEntity, id);
	}

	public async findByAuthUid(authUid: string): Promise<User | null> {
		const rows = await this.db.queryActive(UserEntity, 'auth_uid = $1', [authUid]);
		return rows[0] ?? null;
	}

	// Accepts an optional TransactionHandle so this insert can participate
	// in a caller's transaction (e.g. AdminOperatorsController creating an
	// operator + its user account atomically) instead of always running
	// on its own connection.
	public async create(data: { authUid: string; email: string; role: string; associatedEntityId: number | null }, tx?: TransactionHandle): Promise<User> {
		const db = tx ?? this.db;
		return db.insert(UserEntity, { ...data, isDeleted: false });
	}
}
