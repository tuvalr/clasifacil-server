// AuditLog does not extend BaseEntity
// PostgresHandler's delete/unDelete/queryActive require BaseEntity, so they don't apply here by design; use query() directly for this table.
export interface AuditLog {
	id: number;
	tableName: string;
	recordId: number;
	action: string;
	oldData: unknown;
	newData: unknown;
	changedByUserId: number | null;
	changedAt: Date | null;
}
