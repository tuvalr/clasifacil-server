import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { SessionRepository } from '../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { Session } from '../entities/session.entity';
import { EnrollmentAndCredit } from '../entities/enrollment-and-credit.entity';

export interface BookingConflict {
	conflict: true;
	waitlisted: false;
}

// UC2: Automated Session Booking & Capacity Hard Limits. Operator-side
// session management (create/cancel/roster) and parent-side booking
// live together since both operate on sessions + enrollments_and_credits
// as one domain (session capacity/roster) viewed from two roles.
@injectable()
export class SessionsServer {
	public constructor(
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
	) {}

	// Operator-side

	public async findByOperatorId(operatorId: number): Promise<Session[]> {
		return this.sessions.findByOperatorId(operatorId);
	}

	public async findById(id: number): Promise<Session | null> {
		return this.sessions.findById(id);
	}

	public async getRoster(sessionId: number): Promise<EnrollmentAndCredit[]> {
		return this.enrollments.findBySessionId(sessionId);
	}

	public async create(data: { operatorId: number; title: string; startTime: Date; capacityLimit: number }): Promise<Session> {
		return this.sessions.create(data);
	}

	// PRD UC3 edge case: "Operator Cancels the Class" — must issue a
	// make-up token to ALL enrolled households regardless of the standard
	// cancellation policy window, and log an audit trail. The roster
	// lookup and session cancel are wired; token issuance is not, since
	// there's no cancellation-policy-window config on operators/sessions
	// yet, and audit_logs has no is_deleted-style "which credit rule
	// applied" linkage designed in.
	public async cancel(sessionId: number): Promise<void> {
		await this.sessions.cancel(sessionId);
		// TODO: issue make-up tokens to all enrolled households (roster =
		// this.enrollments.findBySessionId(sessionId)) and write an
		// audit_logs entry — requires the credit-issuance logic from UC3
		// and a defined audit-log write path, neither implemented yet.
	}

	// Parent-side

	public async listEnrollments(householdId: number): Promise<EnrollmentAndCredit[]> {
		return this.enrollments.findByHouseholdId(householdId);
	}

	// PRD UC2: bookings must use row-level locking (SELECT ... FOR UPDATE)
	// to check current_roster_count against capacity_limit and insert the
	// enrollment atomically, so two simultaneous requests for the last
	// slot can't both succeed. PostgresHandler has transaction() support
	// now, but this method hasn't been wired to use it — the check and
	// insert below are NOT atomic and can race under real concurrent
	// load. This is a correctness gap flagged here, not silently
	// accepted.
	public async book(sessionId: number, studentId: number, householdId: number): Promise<EnrollmentAndCredit | BookingConflict | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}

		if ((session.currentRosterCount ?? 0) >= session.capacityLimit) {
			// PRD: route to waitlist instead of rejecting outright — not
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
	// claim window on cancellation) — status is a free-text column with
	// no queue-position or claim-deadline tracking.

	// TODO: browse-by-availability listing (parent session search), not
	// yet designed.
}
