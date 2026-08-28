import { Pool, QueryResultRow, types } from 'pg';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { Config } from '../config/env';
import { Logger } from '../logger/logger';
import { BaseEntity, EntityDescriptor } from '../entities/base.entity';
import { snakeToCamel } from '../utils/case-mapper';

// pg returns BIGINT/NUMERIC as strings by default, since values beyond
// Number.MAX_SAFE_INTEGER (2^53) would silently lose precision as JS
// numbers. BaseEntity.id is typed as `number` for simpler call sites, so
// BIGINT (OID 20) is parsed as a JS number here instead — this is only
// safe as long as no id (or other bigint column) actually exceeds 2^53.
types.setTypeParser(20, (value: string) => Number(value));

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidIdentifier(name: string): void {
	if (!IDENTIFIER_PATTERN.test(name)) {
		throw new Error(`Invalid table identifier "${name}"`);
	}
}

@injectable()
export class PostgresHandler {
	private readonly pool: Pool;

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
		assertValidIdentifier(entity.tableName);
		await this.pool.query(`UPDATE "${entity.tableName}" SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1`, [id]);
	}

	public async unDelete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
		assertValidIdentifier(entity.tableName);
		await this.pool.query(`UPDATE "${entity.tableName}" SET is_deleted = FALSE, deleted_at = NULL WHERE id = $1`, [id]);
	}

	public async queryActive<T extends BaseEntity>(entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
		assertValidIdentifier(entity.tableName);
		const whereClause = where ? `AND (${where})` : '';
		const result = await this.pool.query(`SELECT * FROM "${entity.tableName}" WHERE is_deleted = FALSE ${whereClause}`, params);
		return result.rows.map((row: Record<string, unknown>) => snakeToCamel<T>(row));
	}
}
