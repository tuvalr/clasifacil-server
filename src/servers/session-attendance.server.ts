import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { SessionAttendanceRepository } from '../repositories/session-attendance.repository';
import { SessionRepository } from '../repositories/session.repository';
import { SessionAttendance } from '../entities/session-attendance.entity';
import { ValidationError } from './types/validation-error';

const ARCHIVE_RETENTION_MONTHS = 6;

const VALID_STATUSES: ReadonlySet<string> = new Set(['present', 'absent', 'approved_absent']);

@injectable()
export class SessionAttendanceServer {
	public constructor(
		@inject(TYPES.SessionAttendanceRepository) private readonly attendance: SessionAttendanceRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
	) {}

	// Shared by both the true-one-off endpoint (SessionsController) and the class-linked, date-addressed endpoint
	// (ClassOccurrencesController, Task 5) - the latter passes the already-materialized session's id and its
	// class_id; the former passes classId: null. `entries` arrives as untyped JSON, so it's validated here rather
	// than trusted at the type level (same "don't let untyped JSON garbage reach the database" pattern used
	// throughout this codebase's ClassesServer).
	public async recordForSessionId(sessionId: number, classId: number | null, entries: unknown): Promise<SessionAttendance[] | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}

		// Attendance reports whether a student showed up - a session that hasn't happened yet has no attendance to
		// report. Cutoff is the exact startTime, not the calendar day: a session later today is still "future."
		if (session.startTime.getTime() > Date.now()) {
			throw new ValidationError([{ field: 'attendance', message: 'Cannot record attendance for a session that has not started yet' }]);
		}

		if (!Array.isArray(entries)) {
			throw new ValidationError([{ field: 'attendance', message: 'attendance must be an array' }]);
		}
		for (const entry of entries) {
			if (typeof entry !== 'object' || entry === null || typeof (entry as { studentId?: unknown }).studentId !== 'number') {
				throw new ValidationError([{ field: 'attendance', message: 'each entry requires a numeric studentId' }]);
			}
			const status = (entry as { status?: unknown }).status;
			if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
				throw new ValidationError([{ field: 'attendance', message: 'each entry requires status to be one of present, absent, approved_absent' }]);
			}
		}

		const narrowed = entries as { studentId: number; status: 'present' | 'absent' | 'approved_absent' }[];
		const results: SessionAttendance[] = [];
		for (const entry of narrowed) {
			// Small, bounded batch (a single session's roster) - sequential upserts, matching the sequential-loop
			// style already used throughout ClassesServer for similarly-bounded per-item operations.
			const row = await this.attendance.upsert(sessionId, classId, entry.studentId, entry.status);
			results.push(row);
		}
		return results;
	}

	public async findBySessionId(sessionId: number): Promise<SessionAttendance[]> {
		return this.attendance.findBySessionId(sessionId);
	}

	// Moves every session_attendance row older than 6 months (by updated_at) into session_attendance_history and
	// deletes it from the live table. This repo's actual scale (a monthly manual admin action, not a hot path)
	// doesn't need an explicit transaction wrapper: moveToHistory's two queries (INSERT ... RETURNING, then
	// DELETE ... WHERE id = ANY(...)) already only delete exactly the rows just inserted.
	public async archive(): Promise<number> {
		const cutoff = new Date();
		cutoff.setMonth(cutoff.getMonth() - ARCHIVE_RETENTION_MONTHS);
		return this.attendance.moveToHistory(cutoff);
	}
}
