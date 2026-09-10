import { QueryResultRow } from 'pg';
import { BaseEntity, EntityDescriptor } from '../../entities/base.entity';
import { snakeToCamel, camelToSnake } from '../../utils/case-mapper';

const IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// Satisfied by both Pool and PoolClient — lets every method below run against either a fresh pool connection (normal calls) or a single checked-out client
// held across a transaction (see TransactionHandleFactory / PostgresHandler.transaction()), with identical behavior either way.
export interface Queryable {
	query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// Entity-aware CRUD built on top of a raw Queryable.
// Table/column names are interpolated into SQL (Postgres can't parameterize identifiers),
// so every one is checked against an allowlist first; values are always passed as query parameters, never interpolated.
export class EntityQueryHelper {
	public assertValidIdentifier(name: string): void {
		if (!IDENTIFIER_PATTERN.test(name)) {
			throw new Error(`Invalid table identifier "${name}"`);
		}
	}

	public async delete<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<void> {
		this.assertValidIdentifier(entity.tableName);
		await db.query(`UPDATE "${entity.tableName}" SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
	}

	public async unDelete<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<void> {
		this.assertValidIdentifier(entity.tableName);
		await db.query(`UPDATE "${entity.tableName}" SET is_deleted = FALSE, deleted_at = NULL, updated_at = NOW() WHERE id = $1`, [id]);
	}

	public async queryActive<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
		this.assertValidIdentifier(entity.tableName);
		const whereClause = where ? `AND (${where})` : '';
		const result = await db.query(`SELECT * FROM "${entity.tableName}" WHERE is_deleted = FALSE ${whereClause}`, params);
		return result.rows.map((row: Record<string, unknown>) => snakeToCamel<T>(row));
	}

	public async findById<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
		const rows = await this.queryActive(db, entity, 'id = $1', [id]);
		return rows[0] ?? null;
	}

	// Unlike findById, this ignores is_deleted — for callers (like a restore operation) that need to confirm a row exists at all,
	// including soft-deleted ones.
	public async findByIdIgnoringDeleted<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
		this.assertValidIdentifier(entity.tableName);
		const result = await db.query<Record<string, unknown>>(`SELECT * FROM "${entity.tableName}" WHERE id = $1`, [id]);
		return result.rows[0] ? snakeToCamel<T>(result.rows[0]) : null;
	}

	// `data` uses camelCase keys matching T's TypeScript properties (e.g. { isDeleted: false }), converted to snake_case columns here —
	// callers never need to know or write the underlying column names.
	public async insert<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T> {
		this.assertValidIdentifier(entity.tableName);
		const columns = camelToSnake(data);
		const columnNames = Object.keys(columns);
		columnNames.forEach((name: string) => this.assertValidIdentifier(name));
		const placeholders = columnNames.map((_: string, index: number) => `$${index + 1}`);
		const values = columnNames.map((columnName: string) => columns[columnName]);

		const sql = `INSERT INTO "${entity.tableName}" (${columnNames.map((name: string) => `"${name}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
		const result = await db.query(sql, values);
		return snakeToCamel<T>(result.rows[0]);
	}

	public async update<T extends BaseEntity>(db: Queryable, entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null> {
		this.assertValidIdentifier(entity.tableName);
		const columns = camelToSnake(data);
		const columnNames = Object.keys(columns);
		columnNames.forEach((name: string) => this.assertValidIdentifier(name));
		const values = columnNames.map((columnName: string) => columns[columnName]);

		// No fields to change (e.g. a PUT with an empty/all-optional body) — still touch updated_at rather than
		// building a SET clause with nothing before it, which would be a SQL syntax error.
		const setClause =
			columnNames.length > 0 ? columnNames.map((name: string, index: number) => `"${name}" = $${index + 2}`).join(', ') + ', updated_at = NOW()' : 'updated_at = NOW()';

		const sql = `UPDATE "${entity.tableName}" SET ${setClause} WHERE id = $1 RETURNING *`;
		const result = await db.query(sql, [id, ...values]);
		return result.rows[0] ? snakeToCamel<T>(result.rows[0]) : null;
	}
}
