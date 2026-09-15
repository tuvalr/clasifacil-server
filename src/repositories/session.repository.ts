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

	// Latest non-makeup, non-future materialized session for a class, at or before the given cutoff date — used by
	// the nightly backfill job to find where to resume. Excludes makeup sessions (which are ad hoc and can land far
	// in the future, e.g. "next week's recovery class") and anything after cutoff, so a future makeup session never
	// causes the job to think a class's regular pattern is already backfilled past that point. Returns null if no
	// such session exists yet. Raw query rather than PostgresHandler.queryActive: queryActive wraps its `where`
	// argument as `AND (${where})`, so an ORDER BY/LIMIT clause passed through it would land inside that
	// parenthesized boolean expression and be invalid SQL — matching this file's findByClassIdAndDateIncludingDeleted
	// precedent for going straight to db.query when the shape doesn't fit queryActive's where-only contract.
	public async findLatestRegularByClassIdBefore(classId: number, cutoff: Date): Promise<Session | null> {
		const rows = await this.db.query<Record<string, unknown>>(
			'SELECT * FROM "sessions" WHERE class_id = $1 AND is_deleted = FALSE AND is_makeup_session = FALSE AND start_time <= $2 ORDER BY start_time DESC LIMIT 1',
			[classId, cutoff],
		);
		return rows[0] ? snakeToCamel<Session>(rows[0]) : null;
	}

	// Looks up a class's materialized session by the ORIGINAL pattern date it was derived from — not its current
	// start_time, which a reschedule may have moved elsewhere — INCLUDING soft-deleted (cancelled) rows. Raw query
	// rather than PostgresHandler.queryActive, matching this file's own incrementRosterCount/decrementRosterCount
	// precedent (no generic "ignore-deleted by arbitrary where-clause" helper exists on PostgresHandler; only
	// findByIdIgnoringDeleted, which is by numeric id). Used by ClassOccurrencesServer.materializeOccurrence so a
	// previously-cancelled OR previously-rescheduled-away date is recognized as already materialized (and left
	// alone / not re-derived) instead of getting a second sessions row for the same original slot.
	public async findByClassIdAndOriginalDateIncludingDeleted(classId: number, date: Date): Promise<Session | null> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM "sessions" WHERE class_id = $1 AND original_date = $2::date', [
			classId,
			date.toISOString().slice(0, 10),
		]);
		return rows[0] ? snakeToCamel<Session>(rows[0]) : null;
	}

	// Every original_date a class has ever materialized a session for within [from, to] — regardless of the
	// session's CURRENT start_time (which reschedule may have moved outside this very range) and regardless of
	// is_deleted (cancelled dates must stay excluded too). Used by ClassOccurrencesServer.buildOccurrenceList to
	// build the full set of pattern dates that must never reappear as a fresh virtual occurrence: a cancelled slot,
	// or a slot that was rescheduled to some other date/time, both already have their one true sessions row
	// elsewhere (or soft-deleted) and must not be re-derived from the pattern.
	//
	// Returns YYYY-MM-DD strings (original_date::text), not Date objects: node-postgres parses a DATE column into
	// a JS Date at LOCAL midnight, not UTC midnight — in any timezone ahead of UTC (this deployment's included),
	// re-serializing that Date via toISOString().slice(0, 10) shifts the result back by one calendar day. Casting
	// to text in SQL sidesteps the round-trip entirely and returns exactly what's stored.
	public async findOriginalDatesByClassIdInRange(classId: number, from: Date, to: Date): Promise<string[]> {
		const rows = await this.db.query<{ original_date: string }>(
			'SELECT DISTINCT original_date::text AS original_date FROM "sessions" WHERE class_id = $1 AND original_date IS NOT NULL AND original_date >= $2::date AND original_date <= $3::date',
			[classId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
		);
		return rows.map((row: { original_date: string }) => row.original_date);
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
		originalDate?: Date | null;
		isMakeupSession?: boolean;
	}): Promise<Session> {
		return this.db.insert(SessionEntity, {
			...data,
			classId: data.classId ?? null,
			originalDate: data.originalDate ?? null,
			isMakeupSession: data.isMakeupSession ?? false,
			currentRosterCount: 0,
			isDeleted: false,
		});
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
