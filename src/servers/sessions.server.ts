import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { SessionRepository } from '../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { StudentRepository } from '../repositories/student.repository';
import { HouseholdRepository } from '../repositories/household.repository';
import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';
import { ClassRepository } from '../repositories/class.repository';
import { Session } from '../entities/session.entity';
import { EnrollmentAndCredit } from '../entities/enrollment-and-credit.entity';
import { ClassEnrollment } from '../entities/class-enrollment.entity';
import { Class } from '../entities/class.entity';
import { ValidationError } from './types/validation-error';
import { BookingConflict, PlainSessionNotAllowedError } from './types/sessions.server.types';

// UC2: Automated Session Booking & Capacity Hard Limits. Operator-side
// session management (create/cancel/roster) and household-side booking
// live together since both operate on sessions + enrollments_and_credits
// as one domain (session capacity/roster) viewed from two roles.
@injectable()
export class SessionsServer {
	public constructor(
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
	) {}

	// Class-linked sessions never store their own title (see ClassOccurrencesServer.materializeOccurrence) - this
	// resolves each one's display title live from its parent class, batching by distinct classId so a list of many
	// sessions from the same class costs one extra query, not N.
	private async resolveDisplayTitles(sessions: Session[]): Promise<Session[]> {
		const classIds = [...new Set(sessions.filter((session: Session): boolean => session.classId !== null).map((session: Session): number => session.classId as number))];
		const classById = new Map<number, Class>();
		for (const classId of classIds) {
			// Small, bounded set of distinct classes across one operator's session list - sequential, matching this
			// codebase's existing style for similarly-bounded per-item lookups.
			const foundClass = await this.classes.findById(classId);
			if (foundClass) {
				classById.set(classId, foundClass);
			}
		}
		return sessions.map((session: Session): Session => {
			if (session.classId === null) {
				return session;
			}
			const foundClass = classById.get(session.classId);
			if (!foundClass) {
				return session;
			}
			return { ...session, title: session.isMakeupSession ? `${foundClass.title} - Makeup` : foundClass.title };
		});
	}

	// Operator-side

	public async findByOperatorId(operatorId: number): Promise<Session[] | null> {
		const operator = await this.operators.findById(operatorId);
		if (!operator) {
			return null;
		}
		const sessions = await this.sessions.findByOperatorId(operatorId);
		return this.resolveDisplayTitles(sessions);
	}

	public async findById(id: number): Promise<Session | null> {
		const session = await this.sessions.findById(id);
		if (!session) {
			return null;
		}
		const resolved: Session[] = await this.resolveDisplayTitles([session]);
		return resolved[0];
	}

	// A class-generated occurrence's roster includes the class's standing members (class_enrollments) in addition
	// to whoever's individually booked via enrollments_and_credits - except for makeup sessions, which are ad hoc
	// and only ever show the students explicitly booked into them, never the whole class's standing roster.
	public async getRoster(sessionId: number): Promise<{ enrollments: EnrollmentAndCredit[]; classMemberStudentIds: number[] } | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}
		const enrollments = await this.enrollments.findBySessionId(sessionId);
		if (!session.classId || session.isMakeupSession) {
			return { enrollments, classMemberStudentIds: [] };
		}
		const classEnrollments = await this.classEnrollments.findActiveByClassId(session.classId);
		return { enrollments, classMemberStudentIds: classEnrollments.map((enrollment: ClassEnrollment): number => enrollment.studentId) };
	}

	public async create(data: { operatorId: number; title: string; startTime: Date; capacityLimit: number }): Promise<Session | null> {
		const operator = await this.operators.findById(data.operatorId);
		if (!operator) {
			return null;
		}
		if (operator.type === 'schedule') {
			throw new PlainSessionNotAllowedError();
		}
		return this.sessions.create(data);
	}

	// PRD UC3 edge case: "Operator Cancels the Class" - must issue a
	// make-up token to ALL enrolled households regardless of the standard
	// cancellation policy window, and log an audit trail. The roster
	// lookup and session cancel are wired; token issuance is not, since
	// there's no cancellation-policy-window config on operators/sessions
	// yet, and audit_logs has no is_deleted-style "which credit rule
	// applied" linkage designed in.
	public async cancel(sessionId: number): Promise<Session | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}
		await this.sessions.cancel(sessionId);
		// TODO: issue make-up tokens to all enrolled households (roster =
		// this.enrollments.findBySessionId(sessionId)) and write an
		// audit_logs entry - requires the credit-issuance logic from UC3
		// and a defined audit-log write path, neither implemented yet.
		return session;
	}

	// Single-occurrence override - leaves the class definition and every sibling occurrence untouched. Works on
	// any session (class-generated or plain), same as cancel() already does.
	//
	// Runtime presence/shape check: startTime arrives as untyped JSON, so a missing/malformed value would otherwise
	// become an Invalid Date silently forwarded to SessionRepository.update, which pg would serialize as a garbage
	// literal and Postgres would reject with a raw 500 instead of a clean 400. Same gotcha as
	// ClassesServer.createMakeupSession's startTime check.
	public async reschedule(sessionId: number, startTime: unknown): Promise<Session | null> {
		if (typeof startTime !== 'string' || startTime.length === 0) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime is required' }]);
		}
		const parsedStartTime = new Date(startTime);
		if (Number.isNaN(parsedStartTime.getTime())) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime must be a valid date' }]);
		}

		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}
		return this.sessions.update(sessionId, { startTime: parsedStartTime });
	}

	// Household-side

	public async listEnrollments(householdId: number): Promise<EnrollmentAndCredit[] | null> {
		const household = await this.households.findById(householdId);
		if (!household) {
			return null;
		}
		return this.enrollments.findByHouseholdId(householdId);
	}

	// PRD UC2: bookings must use row-level locking (SELECT ... FOR UPDATE)
	// to check current_roster_count against capacity_limit and insert the
	// enrollment atomically, so two simultaneous requests for the last
	// slot can't both succeed. PostgresHandler has transaction() support
	// now, but this method hasn't been wired to use it - the check and
	// insert below are NOT atomic and can race under real concurrent
	// load. This is a correctness gap flagged here, not silently
	// accepted.
	public async book(sessionId: number, studentId: number, householdId: number): Promise<EnrollmentAndCredit | BookingConflict | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}

		const student = await this.students.findById(studentId);
		if (!student) {
			return null;
		}

		const household = await this.households.findById(householdId);
		if (!household) {
			return null;
		}

		if ((session.currentRosterCount ?? 0) >= session.capacityLimit) {
			// PRD: route to waitlist instead of rejecting outright - not
			// implemented (see waitlist TODOs), so this only reports the
			// capacity conflict for now.
			return { conflict: true, waitlisted: false };
		}

		const enrollment = await this.enrollments.create({ studentId, sessionId, householdId, status: 'booked' });
		await this.sessions.incrementRosterCount(sessionId);
		return enrollment;
	}

	// TODO: requires a real waitlist (PRD: "queue-based waitlist ordered
	// strictly by timestamp", automated promotion with a time-sensitive
	// claim window on cancellation) - status is a free-text column with
	// no queue-position or claim-deadline tracking.

	// TODO: browse-by-availability listing (household session search), not
	// yet designed.
}
