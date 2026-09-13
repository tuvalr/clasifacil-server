import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { Session, SessionEntity } from '../entities/session.entity';
import { snakeToCamel } from '../utils/case-mapper';

@injectable()
export class SessionRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByOperatorId(operatorId: number): Promise<Session[]> {
		return this.db.queryActive(SessionEntity, 'operator_id = $1', [operatorId]);
	}

	public async findByClassIdInRange(classId: number, from: Date, to: Date): Promise<Session[]> {
		return this.db.queryActive(SessionEntity, 'class_id = $1 AND start_time >= $2 AND start_time <= $3', [classId, from, to]);
	}

	// Latest materialized session for a class, regardless of date range — used by the nightly backfill job (Task
	// 6) to find where to resume materializing from. Returns null if the class has no materialized sessions yet.
	public async findLatestByClassId(classId: number): Promise<Session | null> {
		const rows = await this.db.queryActive(SessionEntity, 'class_id = $1 ORDER BY start_time DESC LIMIT 1', [classId]);
		return rows[0] ?? null;
	}

	public async findByClassIdAndDate(classId: number, date: Date): Promise<Session | null> {
		// Matches on the calendar date portion of start_time — a materialized session's exact time-of-day may
		// differ from the class's pattern (e.g. already rescheduled), but there is still only ever one
		// materialized session per class per calendar day, by construction (materializeOccurrence is idempotent
		// per date).
		const rows = await this.db.queryActive(SessionEntity, 'class_id = $1 AND DATE(start_time) = $2::date', [classId, date.toISOString().slice(0, 10)]);
		return rows[0] ?? null;
	}

	// Same lookup as findByClassIdAndDate, but INCLUDING soft-deleted (cancelled) rows — raw query rather than
	// PostgresHandler.queryActive, matching this file's own incrementRosterCount/decrementRosterCount precedent
	// (no generic "ignore-deleted by arbitrary where-clause" helper exists on PostgresHandler; only
	// findByIdIgnoringDeleted, which is by numeric id). Used by ClassOccurrencesServer.materializeOccurrence so a
	// previously-cancelled date is recognized as already materialized (and left alone) instead of getting a second
	// sessions row.
	public async findByClassIdAndDateIncludingDeleted(classId: number, date: Date): Promise<Session | null> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM "sessions" WHERE class_id = $1 AND DATE(start_time) = $2::date', [
			classId,
			date.toISOString().slice(0, 10),
		]);
		return rows[0] ? snakeToCamel<Session>(rows[0]) : null;
	}

	// Same range query as findByClassIdInRange, but INCLUDING soft-deleted (cancelled) rows — used by
	// ClassOccurrencesServer.buildOccurrenceList to build the set of dates that must be excluded from virtual-date
	// generation entirely (a cancelled date must never reappear as a fresh virtual occurrence).
	public async findByClassIdInRangeIncludingDeleted(classId: number, from: Date, to: Date): Promise<Session[]> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM "sessions" WHERE class_id = $1 AND start_time >= $2 AND start_time <= $3', [classId, from, to]);
		return rows.map((row: Record<string, unknown>) => snakeToCamel<Session>(row));
	}

	public async findById(id: number): Promise<Session | null> {
		return this.db.findById(SessionEntity, id);
	}

	public async create(data: {
		operatorId: number;
		title: string | null;
		startTime: Date;
		capacityLimit: number;
		classId?: number | null;
		isMakeupSession?: boolean;
	}): Promise<Session> {
		return this.db.insert(SessionEntity, { ...data, classId: data.classId ?? null, isMakeupSession: data.isMakeupSession ?? false, currentRosterCount: 0, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ title: string; startTime: Date; capacityLimit: number }>): Promise<Session | null> {
		return this.db.update(SessionEntity, id, data);
	}

	public async cancel(id: number): Promise<void> {
		return this.db.delete(SessionEntity, id);
	}

	// Uses a raw query rather than PostgresHandler.update(): the PRD (UC2)
	// requires this increment to be part of an atomic, row-locked
	// transaction (SELECT ... FOR UPDATE) to prevent two simultaneous
	// bookings from both reading a stale roster count. That transaction
	// support doesn't exist on PostgresHandler yet — see the booking
	// controller's TODO for the real atomic implementation.
	public async incrementRosterCount(id: number): Promise<void> {
		await this.db.query('UPDATE "sessions" SET current_roster_count = current_roster_count + 1, updated_at = NOW() WHERE id = $1', [id]);
	}

	public async decrementRosterCount(id: number): Promise<void> {
		await this.db.query('UPDATE "sessions" SET current_roster_count = current_roster_count - 1, updated_at = NOW() WHERE id = $1', [id]);
	}
}
