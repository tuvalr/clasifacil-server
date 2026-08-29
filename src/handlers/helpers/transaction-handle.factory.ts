import { PoolClient, QueryResultRow } from 'pg';
import { BaseEntity, EntityDescriptor } from '../../entities/base.entity';
import { EntityQueryHelper } from './entity-query.helper';

// The API surface handed to a PostgresHandler.transaction() callback:
// same method names/behavior as PostgresHandler's own entity methods,
// but every call runs against the one client held for the transaction's
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

export class TransactionHandleFactory {
	public constructor(private readonly entityQuery: EntityQueryHelper) {}

	public create(client: PoolClient): TransactionHandle {
		const entityQuery = this.entityQuery;

		return {
			async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
				const result = await client.query<T>(sql, params);
				return result.rows;
			},
			async delete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
				return entityQuery.delete(client, entity, id);
			},
			async unDelete<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<void> {
				return entityQuery.unDelete(client, entity, id);
			},
			async queryActive<T extends BaseEntity>(entity: EntityDescriptor<T>, where?: string, params?: unknown[]): Promise<T[]> {
				return entityQuery.queryActive(client, entity, where, params);
			},
			async findById<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number): Promise<T | null> {
				return entityQuery.findById(client, entity, id);
			},
			async insert<T extends BaseEntity>(entity: EntityDescriptor<T>, data: Record<string, unknown>): Promise<T> {
				return entityQuery.insert(client, entity, data);
			},
			async update<T extends BaseEntity>(entity: EntityDescriptor<T>, id: string | number, data: Record<string, unknown>): Promise<T | null> {
				return entityQuery.update(client, entity, id, data);
			},
		};
	}
}
