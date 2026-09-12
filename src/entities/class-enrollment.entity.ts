// Does not extend BaseEntity — no soft-delete concept here (status: 'active' | 'removed' covers it instead).
// PostgresHandler's delete/unDelete/queryActive/insert/update require BaseEntity's is_deleted/deleted_at columns,
// so they don't apply here by design; use PostgresHandler.query() directly for this table, same as AuditLog.
export interface ClassEnrollment {
	id: number;
	classId: number;
	studentId: number;
	status: 'active' | 'removed';
	createdAt: Date;
	updatedAt: Date;
}
