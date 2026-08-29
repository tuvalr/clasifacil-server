import { Pool, QueryResultRow, types } from 'pg';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { Config } from '../config/env';
import { Logger } from '../logger/logger';
import { BaseEntity, EntityDescriptor } from '../entities/base.entity';
import { EntityQueryHelper } from './helpers/entity-query.helper';
import { TransactionHandle, TransactionHandleFactory } from './helpers/transaction-handle.factory';

export { TransactionHandle } from './helpers/transaction-handle.factory';

// pg returns BIGINT/NUMERIC as strings by default, since values beyond Number.
// MAX_SAFE_INTEGER (2^53) would silently lose precision as JS numbers.
// BaseEntity.id is typed as `number` for simpler call sites, so BIGINT (OID 20) is parsed as a JS number here instead —
// this is only safe as long as no id (or other bigint column) actually exceeds 2^53.
types.setTypeParser(20, (value: string) => Number(value));

@injectable()
export class PostgresHandler {
	private readonly pool: Pool;
	private readonly entityQuery: EntityQueryHelper = new EntityQueryHelper();
	private readonly transactionHandleFactory: TransactionHandleFactory = new TransactionHandleFactory(this.entityQuery);

	public constructor(
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.Logger) private readonly logger: Logger,
	) {
		this.pool = new Pool({
			host: this.config.pgHost,
			port: this.config.pgPort,
			user: this.config.pgUser,
			password: this.config.pgPassword,
			database: this.config.pgDatabase,
		});
	}

	public async connect(): Promise<void> {
		await this.pool.query('SELECT 1');
		this.logger.info('postgres connected', { host: this.config.pgHost, database: this.config.pgDatabase });
	}

	public async disconnect(): Promise<void> {
		await this.pool.end();
		this.logger.info('postgres disconnected');
	}

	public async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
		const result = await this.pool.query<T>(sql, params);
		return result.rows;
	}

	public async delete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
		return this.entityQuery.delete(this.pool, entity, id);
	}

	public async unDelete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
		return this.entityQuery.unDelete(this.pool, entity, id);
	}

	public async queryActive<T extends BaseEntity>(entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
		return this.entityQuery.queryActive(this.pool, entity, where, params);
	}

	public async findById<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
		return this.entityQuery.findById(this.pool, entity, id);
	}

	public async insert<T extends BaseEntity>(entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T> {
		return this.entityQuery.insert(this.pool, entity, data);
	}

	public async update<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null> {
		return this.entityQuery.update(this.pool, entity, id, data);
	}

	// Checks out a single client, runs BEGIN, hands the callback a TransactionHandle bound to that client, then COMMITs on success or ROLLBACKs (and rethrows) on failure.
	// Use this whenever multiple writes must succeed or fail together — see AdminOperatorsController for an example (operator + its user account).
	public async transaction<T>(callback: (tx: TransactionHandle) => Promise<T>): Promise<T> {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const result = await callback(this.transactionHandleFactory.create(client));
			await client.query('COMMIT');
			return result;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}
}
