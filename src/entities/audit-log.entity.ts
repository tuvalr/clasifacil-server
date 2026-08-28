// AuditLog does not extend BaseEntity: audit_logs has no is_deleted /
// deleted_at columns (an append-only audit trail isn't meant to be
// soft-deletable), and no created_at / updated_at — only changed_at.
// PostgresHandler's delete/unDelete/queryActive require BaseEntity, so
// they don't apply here by design; use query() directly for this table.
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
