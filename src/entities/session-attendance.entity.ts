// Does not extend BaseEntity — no soft-delete concept (rows are moved to session_attendance_history, never
// soft-deleted in place). Modeled after ClassEnrollment/AuditLog's existing no-soft-delete precedent in this
// codebase; access it via PostgresHandler.query() directly, never via queryActive/insert/update/delete.
export interface SessionAttendance {
	id: number;
	sessionId: number;
	classId: number | null;
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent';
	createdAt: Date;
	updatedAt: Date;
}
