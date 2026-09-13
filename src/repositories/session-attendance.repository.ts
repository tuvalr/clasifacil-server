import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { SessionAttendance } from '../entities/session-attendance.entity';
import { snakeToCamel } from '../utils/case-mapper';

@injectable()
export class SessionAttendanceRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findBySessionId(sessionId: number): Promise<SessionAttendance[]> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM session_attendance WHERE session_id = $1', [sessionId]);
		return rows.map((row: Record<string, unknown>) => snakeToCamel<SessionAttendance>(row));
	}

	// One row per (session_id, student_id) — inserts on first mark, updates status/updated_at in place on every
	// subsequent mark for the same pair. Never creates a second row for the same pair (see the DB's
	// session_attendance_unique constraint, which this query relies on via ON CONFLICT).
	public async upsert(sessionId: number, classId: number | null, studentId: number, status: 'present' | 'absent' | 'approved_absent'): Promise<SessionAttendance> {
		const rows = await this.db.query<Record<string, unknown>>(
			`INSERT INTO session_attendance (session_id, class_id, student_id, status)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (session_id, student_id)
			 DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
			 RETURNING *`,
			[sessionId, classId, studentId, status],
		);
		return snakeToCamel<SessionAttendance>(rows[0]);
	}

	// Moves every row older than `cutoff` (by updated_at) into session_attendance_history and deletes it from the
	// live table, in one transaction (both queries run against the same client via a single multi-statement call —
	// PostgresHandler.query uses the pool directly, so this uses two sequential queries wrapped by the caller's
	// transaction instead; see SessionAttendanceServer.archive for the transaction wrapping).
	public async moveToHistory(cutoff: Date): Promise<number> {
		const inserted = await this.db.query<{ id: string }>(
			`INSERT INTO session_attendance_history (id, session_id, class_id, student_id, status, created_at, updated_at)
			 SELECT id, session_id, class_id, student_id, status, created_at, updated_at
			 FROM session_attendance
			 WHERE updated_at < $1
			 RETURNING id`,
			[cutoff],
		);
		if (inserted.length === 0) {
			return 0;
		}
		const ids = inserted.map((row: { id: string }) => Number(row.id));
		await this.db.query('DELETE FROM session_attendance WHERE id = ANY($1::bigint[])', [ids]);
		return ids.length;
	}
}
