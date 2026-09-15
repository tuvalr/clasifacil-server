import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { SessionRepository } from '../repositories/session.repository';
import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';
import { ClassEnrollment } from '../entities/class-enrollment.entity';
import { StudentRepository } from '../repositories/student.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { Class } from '../entities/class.entity';
import { Session } from '../entities/session.entity';
import { SessionAttendance } from '../entities/session-attendance.entity';
import { SessionAttendanceServer } from './session-attendance.server';
import { ValidationError } from './types/validation-error';

const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface OccurrenceAttendanceEntry {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent' | 'not_recorded';
}

export interface VirtualOccurrence {
	classId: number;
	startTime: Date;
	isVirtual: true;
	displayTitle: string;
	attendance?: OccurrenceAttendanceEntry[];
}

export interface MaterializedOccurrence {
	session: Session;
	isVirtual: false;
	displayTitle: string;
	attendance?: OccurrenceAttendanceEntry[];
}

export type Occurrence = VirtualOccurrence | MaterializedOccurrence;

export interface OccurrenceListResult {
	occurrences: Occurrence[];
	classMemberStudentIds: number[];
}

function parseDateOnly(value: unknown, field: string): Date {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ValidationError([{ field, message: `${field} is required` }]);
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError([{ field, message: `${field} must be a valid date (YYYY-MM-DD)` }]);
	}
	return parsed;
}

function validateRange(from: Date, to: Date): void {
	if (to.getTime() < from.getTime()) {
		throw new ValidationError([{ field: 'to', message: 'to must not be before from' }]);
	}
	const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
	if (days > MAX_RANGE_DAYS) {
		throw new ValidationError([{ field: 'to', message: `Range cannot exceed ${MAX_RANGE_DAYS} days` }]);
	}
}

@injectable()
export class ClassOccurrencesServer {
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
		@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendance: SessionAttendanceServer,
	) {}

	// Walks every date in [from, to] matching the class's dayOfWeek, clipped to stoppedAt if the class is stopped
	// (no dates on/after the stop day). Pure computation — never reads or writes sessions.
	private computeOccurrenceDates(foundClass: Class, from: Date, to: Date): Date[] {
		const [hours, minutes, seconds]: number[] = foundClass.startTime.split(':').map(Number);
		let effectiveTo = to;
		if (foundClass.status === 'stopped' && foundClass.stoppedAt) {
			// Clip to the start of the UTC day the class was stopped on (not the exact stop instant) — this feature
			// is calendar-day-based everywhere else (parseDateOnly, the DATE(... AT TIME ZONE 'UTC') lookups, the
			// 90-day cap), and clipping on a wall-clock instant would make the stop-day occurrence's inclusion
			// depend on what time of day the operator happened to click "stop," which the spec doesn't intend. A
			// class is considered stopped as of the start of its stop day, so that day's own occurrence never
			// occurs, regardless of whether the stop happened before or after the class's usual startTime.
			const stoppedDay = new Date(foundClass.stoppedAt.toISOString().slice(0, 10) + 'T00:00:00.000Z');
			const dayBeforeStop = new Date(stoppedDay.getTime() - MS_PER_DAY);
			if (dayBeforeStop.getTime() < effectiveTo.getTime()) {
				effectiveTo = dayBeforeStop;
			}
		}

		const dates: Date[] = [];
		const cursor = new Date(from);
		cursor.setUTCHours(hours, minutes, seconds ?? 0, 0);
		while (cursor.getUTCDay() !== foundClass.dayOfWeek) {
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		while (cursor.getTime() <= effectiveTo.getTime()) {
			dates.push(new Date(cursor));
			cursor.setUTCDate(cursor.getUTCDate() + 7);
		}
		return dates;
	}

	private async buildOccurrenceList(classId: number, from: Date, to: Date): Promise<OccurrenceListResult | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}

		const virtualDates = this.computeOccurrenceDates(foundClass, from, to);
		const materialized = await this.sessions.findByClassIdInRange(classId, from, to);

		// Every pattern date this class has EVER materialized a session for in range — keyed by original_date (the
		// date the session was first derived for), not its current start_time. This single set correctly excludes
		// a virtual re-derivation for all three ways a pattern date can already have a real row: cancelled in
		// place, materialized in place (already covered by `materialized` above, but harmless to also list here),
		// and rescheduled away to some other date/time (session's start_time may now even fall outside this very
		// range, which is exactly why this must be keyed by original_date and queried independently of
		// findByClassIdInRange's start_time-based range filter).
		const originalDateKeys = new Set(await this.sessions.findOriginalDatesByClassIdInRange(classId, from, to));

		// Class-linked sessions never store their own title (see materializeOccurrence's title: null) — display
		// title is always resolved live from the parent class's current title, computed once per call here since
		// foundClass is already loaded for the whole list.
		const regularDisplayTitle = foundClass.title;
		const makeupDisplayTitle = `${foundClass.title} — Makeup`;

		const occurrences: Occurrence[] = materialized.map((session: Session) => ({
			session,
			isVirtual: false,
			displayTitle: session.isMakeupSession ? makeupDisplayTitle : regularDisplayTitle,
		}));
		for (const date of virtualDates) {
			const key = date.toISOString().slice(0, 10);
			if (!originalDateKeys.has(key)) {
				occurrences.push({ classId, startTime: date, isVirtual: true, displayTitle: regularDisplayTitle });
			}
		}
		occurrences.sort((a: Occurrence, b: Occurrence) => {
			const aTime = a.isVirtual ? a.startTime.getTime() : a.session.startTime.getTime();
			const bTime = b.isVirtual ? b.startTime.getTime() : b.session.startTime.getTime();
			return aTime - bTime;
		});

		const classMembers = await this.classEnrollments.findActiveByClassId(classId);
		return { occurrences, classMemberStudentIds: classMembers.map((enrollment: ClassEnrollment): number => enrollment.studentId) };
	}

	public async listFuture(classId: number, from: unknown, to: unknown): Promise<OccurrenceListResult | null> {
		const parsedFrom = parseDateOnly(from, 'from');
		const parsedTo = parseDateOnly(to, 'to');
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
		if (parsedFrom.getTime() < today.getTime()) {
			throw new ValidationError([{ field: 'from', message: 'from must be today or later' }]);
		}
		validateRange(parsedFrom, parsedTo);
		return this.buildOccurrenceList(classId, parsedFrom, parsedTo);
	}

	public async listPast(classId: number, from: unknown, to: unknown): Promise<OccurrenceListResult | null> {
		const parsedFrom = parseDateOnly(from, 'from');
		const parsedTo = parseDateOnly(to, 'to');
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
		if (parsedTo.getTime() > today.getTime()) {
			throw new ValidationError([{ field: 'to', message: 'to must be today or earlier' }]);
		}
		validateRange(parsedFrom, parsedTo);
		const result = await this.buildOccurrenceList(classId, parsedFrom, parsedTo);
		if (!result) {
			return null;
		}
		return this.attachAttendance(result);
	}

	// For each materialized occurrence, synthesizes 'not_recorded' for any roster/class-member student who has no
	// session_attendance row yet — never stored, computed only at read time (see the spec's not_recorded
	// semantics). Virtual (never-materialized) past dates get the same treatment: every roster student reported
	// not_recorded, since no session_attendance rows can exist for a date with no sessions row at all. Only called
	// from listPast — listFuture must not pay for these extra attendance queries.
	private async attachAttendance(result: OccurrenceListResult): Promise<OccurrenceListResult> {
		const occurrencesWithAttendance: Occurrence[] = [];
		for (const occurrence of result.occurrences) {
			if (occurrence.isVirtual) {
				occurrencesWithAttendance.push({
					...occurrence,
					attendance: result.classMemberStudentIds.map((studentId: number): OccurrenceAttendanceEntry => ({ studentId, status: 'not_recorded' })),
				});
				continue;
			}
			// One query per materialized session in range — bounded by the 90-day range cap, same order of
			// magnitude as buildOccurrenceList's own per-call queries.
			const recorded = await this.sessionAttendance.findBySessionId(occurrence.session.id);
			const recordedByStudentId = new Map(recorded.map((row: SessionAttendance): [number, SessionAttendance] => [row.studentId, row]));
			const attendance: OccurrenceAttendanceEntry[] = result.classMemberStudentIds.map((studentId: number): OccurrenceAttendanceEntry => {
				const row = recordedByStudentId.get(studentId);
				return { studentId, status: row ? row.status : 'not_recorded' };
			});
			// Include any recorded row for a student NOT in the current standing roster too (a trial student, or
			// someone since unassigned) — the spec's trial-student attendance must still be visible in the past
			// view.
			for (const row of recorded) {
				if (!result.classMemberStudentIds.includes(row.studentId)) {
					attendance.push({ studentId: row.studentId, status: row.status });
				}
			}
			occurrencesWithAttendance.push({ ...occurrence, attendance });
		}
		return { ...result, occurrences: occurrencesWithAttendance };
	}

	// Idempotent: returns the existing materialized row for this class+date if one already exists, otherwise
	// creates one with the pattern's default startTime and title: null (display always reads the class's current
	// title live — see docs/superpowers/specs/2026-09-13-derived-class-sessions-design.md). originalDate is set to
	// this same `date` at creation and never changes afterward — it's the occurrence's permanent identity, so a
	// later reschedule (which moves startTime elsewhere) never causes this original slot to be re-derived as a
	// fresh virtual occurrence, and never causes a second sessions row to be created for it.
	//
	// Looks up by originalDate INCLUDING soft-deleted rows (findByClassIdAndOriginalDateIncludingDeleted), not just
	// live ones and not by current startTime: if this date was already cancelled OR already rescheduled to some
	// other date/time, that existing row (wherever its startTime now points, or however it's marked deleted) is the
	// correct "existing" answer — returned as-is, never un-deleted, never duplicated. Callers that need "not found"
	// semantics for an already-cancelled date (reschedule, attendance) check the returned session's isDeleted
	// themselves; cancelOccurrence treats re-cancelling as an idempotent no-op instead.
	public async materializeOccurrence(classId: number, date: Date): Promise<Session> {
		const existing = await this.sessions.findByClassIdAndOriginalDateIncludingDeleted(classId, date);
		if (existing) {
			return existing;
		}
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		const [hours, minutes, seconds]: number[] = foundClass.startTime.split(':').map(Number);
		const startTime = new Date(date);
		startTime.setUTCHours(hours, minutes, seconds ?? 0, 0);
		return this.sessions.create({
			operatorId: foundClass.operatorId,
			title: null,
			startTime,
			capacityLimit: foundClass.maxSize,
			classId: foundClass.id,
			originalDate: date,
			isMakeupSession: false,
		});
	}

	public async rescheduleOccurrence(classId: number, date: unknown, newStartTime: unknown): Promise<Session | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}
		const parsedDate = parseDateOnly(date, 'date');
		if (typeof newStartTime !== 'string' || newStartTime.length === 0) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime is required' }]);
		}
		const parsedNewStartTime = new Date(newStartTime);
		if (Number.isNaN(parsedNewStartTime.getTime())) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime must be a valid date' }]);
		}
		const session = await this.materializeOccurrence(classId, parsedDate);
		// A cancelled date reported as "not found" for reschedule mirrors the existing numeric-id-addressed
		// endpoint's behavior exactly: SessionsServer.reschedule looks a session up via SessionRepository.findById,
		// which (built on queryActive) already returns null for a soft-deleted session, so rescheduling an
		// already-cancelled one-off session 404s today. Silently updating startTime on the cancelled row instead
		// would return 200 while changing nothing visible (the row stays invisible to every listing), which is
		// worse than a clear 404 — an operator who wants a cancelled date back should un-cancel it explicitly
		// (no such endpoint exists yet; out of this task's scope), not have a reschedule call resurrect it.
		if (session.isDeleted) {
			return null;
		}
		const updated = await this.sessions.update(session.id, { startTime: parsedNewStartTime });
		if (!updated) {
			return null;
		}
		// The DB row's title stays null (see materializeOccurrence) — this patches only the in-memory object
		// returned to the caller so the response shows the class-linked display title, same resolution as
		// buildOccurrenceList uses for the occurrence-list endpoints.
		return { ...updated, title: updated.isMakeupSession ? `${foundClass.title} — Makeup` : foundClass.title };
	}

	public async cancelOccurrence(classId: number, date: unknown): Promise<Session | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}
		const parsedDate = parseDateOnly(date, 'date');
		const session = await this.materializeOccurrence(classId, parsedDate);
		// Cancelling an already-cancelled date is treated as an idempotent no-op success (matching how
		// PostgresHandler.delete/EntityQueryHelper.delete is itself idempotent — re-running the same UPDATE ...
		// SET is_deleted = TRUE has no further effect) rather than an error: the caller's desired end state
		// ("this date is cancelled") already holds, so there's nothing to reject.
		if (!session.isDeleted) {
			await this.sessions.cancel(session.id);
		}
		return session;
	}

	// Makeup sessions accept the class's current standing roster only (no per-makeup studentId list — see the
	// spec's confirmed reversal of the original 2026-09-12 design). Always materialized immediately (never
	// virtual) since it's an explicit exception, not part of the weekly derivation.
	public async createMakeupSession(classId: number, startTime: unknown): Promise<Session> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		if (typeof startTime !== 'string' || startTime.length === 0) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime is required' }]);
		}
		const parsedStartTime = new Date(startTime);
		if (Number.isNaN(parsedStartTime.getTime())) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime must be a valid date' }]);
		}

		const session = await this.sessions.create({
			operatorId: foundClass.operatorId,
			title: null,
			startTime: parsedStartTime,
			capacityLimit: foundClass.maxSize,
			classId: foundClass.id,
			isMakeupSession: true,
		});

		const classMembers = await this.classEnrollments.findActiveByClassId(classId);
		for (const member of classMembers) {
			// Small, bounded roster (a single class's standing members) — sequential, matching this codebase's
			// existing style for similarly-bounded per-item operations.
			const student = await this.students.findById(member.studentId);
			if (!student) {
				continue;
			}
			await this.enrollments.create({ studentId: member.studentId, sessionId: session.id, householdId: student.householdId, status: 'booked' });
			await this.sessions.incrementRosterCount(session.id);
		}

		// The DB row's title stays null (see materializeOccurrence) — this patches only the in-memory object
		// returned to the caller so the response shows the class-linked display title.
		return { ...session, title: `${foundClass.title} — Makeup` };
	}
}
