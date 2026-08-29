import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { Config } from '../config/env';
import { Logger } from '../logger/logger';
import { BaseEntity, EntityDescriptor } from '../entities/base.entity';
import { snakeToCamel, camelToSnake } from '../utils/case-mapper';

// pg returns BIGINT/NUMERIC as strings by default, since values beyond Number.
// MAX_SAFE_INTEGER (2^53) would silently lose precision as JS numbers.
// BaseEntity.id is typed as `number` for simpler call sites, so BIGINT (OID 20) is parsed as a JS number here instead —
// this is only safe as long as no id (or other bigint column) actually exceeds 2^53.
types.setTypeParser(20, (value: string) => Number(value));

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidIdentifier(name: string): void {
	if (!IDENTIFIER_PATTERN.test(name)) {
		throw new Error(`Invalid table identifier "${name}"`);
	}
}

// Satisfied by both Pool and PoolClient — lets the entity operations
// below run against either a fresh pool connection (normal calls) or a
// single checked-out client held across a transaction (see
// PostgresHandler.transaction()), with identical behavior either way.
interface Queryable {
	query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

async function deleteEntity<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<void> {
	assertValidIdentifier(entity.tableName);
	await db.query(`UPDATE "${entity.tableName}" SET is_deleted = TRUE, deleted_at = NOW() WHERE id = $1`, [id]);
}

async function unDeleteEntity<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<void> {
	assertValidIdentifier(entity.tableName);
	await db.query(`UPDATE "${entity.tableName}" SET is_deleted = FALSE, deleted_at = NULL WHERE id = $1`, [id]);
}

async function queryActiveEntity<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
	assertValidIdentifier(entity.tableName);
	const whereClause = where ? `AND (${where})` : '';
	const result = await db.query(`SELECT * FROM "${entity.tableName}" WHERE is_deleted = FALSE ${whereClause}`, params);
	return result.rows.map((row: Record<string, unknown>) => snakeToCamel<T>(row));
}

async function findEntityById<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
	const rows = await queryActiveEntity(db, entity, 'id = $1', [id]);
	return rows[0] ?? null;
}

// `data` uses camelCase keys matching T's TypeScript properties (e.g.
// { isDeleted: false }), converted to snake_case columns here — callers
// never need to know or write the underlying column names.
async function insertEntity<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T> {
	assertValidIdentifier(entity.tableName);
	const columns = camelToSnake(data);
	const columnNames = Object.keys(columns);
	columnNames.forEach(assertValidIdentifier);
	const placeholders = columnNames.map((_: string, index: number) => `$${index + 1}`);
	const values = columnNames.map((columnName: string) => columns[columnName]);

	const sql = `INSERT INTO "${entity.tableName}" (${columnNames.map((name: string) => `"${name}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
	const result = await db.query(sql, values);
	return snakeToCamel<T>(result.rows[0]);
}

async function updateEntity<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null> {
	assertValidIdentifier(entity.tableName);
	const columns = camelToSnake(data);
	const columnNames = Object.keys(columns);
	columnNames.forEach(assertValidIdentifier);
	const setClause = columnNames.map((name: string, index: number) => `"${name}" = $${index + 2}`).join(', ');
	const values = columnNames.map((columnName: string) => columns[columnName]);

	const sql = `UPDATE "${entity.tableName}" SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`;
	const result = await db.query(sql, [id, ...values]);
	return result.rows[0] ? snakeToCamel<T>(result.rows[0]) : null;
}

// The API surface handed to a transaction() callback: same method
// names/behavior as PostgresHandler's own entity methods, but every
// call runs against the one client held for the transaction's
// lifetime instead of a fresh pool connection.
export interface TransactionHandle {
	query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
	delete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void>;
	unDelete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void>;
	queryActive<T extends BaseEntity>(entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]>;
	findById<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<T | null>;
	insert<T extends BaseEntity>(entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T>;
	update<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null>;
}

function createTransactionHandle(client: PoolClient): TransactionHandle {
	return {
		async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
			const result = await client.query<T>(sql, params);
			return result.rows;
		},
		async delete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
			return deleteEntity(client, entity, id);
		},
		async unDelete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
			return unDeleteEntity(client, entity, id);
		},
		async queryActive<T extends BaseEntity>(entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
			return queryActiveEntity(client, entity, where, params);
		},
		async findById<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
			return findEntityById(client, entity, id);
		},
		async insert<T extends BaseEntity>(entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T> {
			return insertEntity(client, entity, data);
		},
		async update<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null> {
			return updateEntity(client, entity, id, data);
		},
	};
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
		return deleteEntity(this.pool, entity, id);
	}

	public async unDelete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
		return unDeleteEntity(this.pool, entity, id);
	}

	public async queryActive<T extends BaseEntity>(entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
		return queryActiveEntity(this.pool, entity, where, params);
	}

	public async findById<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
		return findEntityById(this.pool, entity, id);
	}

	public async insert<T extends BaseEntity>(entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T> {
		return insertEntity(this.pool, entity, data);
	}

	public async update<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null> {
		return updateEntity(this.pool, entity, id, data);
	}

	// Checks out a single client, runs BEGIN, hands the callback a
	// TransactionHandle bound to that client, then COMMITs on success or
	// ROLLBACKs (and rethrows) on failure. Use this whenever multiple
	// writes must succeed or fail together — see AdminOperatorsController
	// for an example (operator + its user account).
	public async transaction<T>(callback: (tx: TransactionHandle) => Promise<T>): Promise<T> {
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			const result = await callback(createTransactionHandle(client));
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
