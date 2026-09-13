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
import { ValidationError } from './types/validation-error';

const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface VirtualOccurrence {
	classId: number;
	startTime: Date;
	isVirtual: true;
}

export interface MaterializedOccurrence {
	session: Session;
	isVirtual: false;
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
	) {}

	// Walks every date in [from, to] matching the class's dayOfWeek, clipped to stoppedAt if the class is stopped
	// (no dates on/after the stop moment). Pure computation — never reads or writes sessions.
	private computeOccurrenceDates(foundClass: Class, from: Date, to: Date): Date[] {
		const [hours, minutes, seconds]: number[] = foundClass.startTime.split(':').map(Number);
		const effectiveTo = foundClass.status === 'stopped' && foundClass.stoppedAt && foundClass.stoppedAt.getTime() < to.getTime() ? foundClass.stoppedAt : to;

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
		const materializedDateKeys = new Set(materialized.map((session: Session) => session.startTime.toISOString().slice(0, 10)));

		const occurrences: Occurrence[] = materialized.map((session: Session) => ({ session, isVirtual: false }));
		for (const date of virtualDates) {
			const key = date.toISOString().slice(0, 10);
			if (!materializedDateKeys.has(key)) {
				occurrences.push({ classId, startTime: date, isVirtual: true });
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
		return this.buildOccurrenceList(classId, parsedFrom, parsedTo);
	}

	// Idempotent: returns the existing materialized row for this class+date if one already exists, otherwise
	// creates one with the pattern's default startTime and title: null (display always reads the class's current
	// title live — see docs/superpowers/specs/2026-09-13-derived-class-sessions-design.md).
	public async materializeOccurrence(classId: number, date: Date): Promise<Session> {
		const existing = await this.sessions.findByClassIdAndDate(classId, date);
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
		return this.sessions.update(session.id, { startTime: parsedNewStartTime });
	}

	public async cancelOccurrence(classId: number, date: unknown): Promise<Session | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}
		const parsedDate = parseDateOnly(date, 'date');
		const session = await this.materializeOccurrence(classId, parsedDate);
		await this.sessions.cancel(session.id);
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

		return session;
	}
}
