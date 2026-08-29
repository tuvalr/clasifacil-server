import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { SessionRepository } from '../repositories/session.repository';
import { EnrollmentAndCredit } from '../entities/enrollment-and-credit.entity';

const CREDIT_EXPIRY_DAYS = 90;

// UC3: Attendance Tracking & Automated Make-Up Credit State Machine.
// Operator-side (policy config, viewing state) and parent-side
// (cancelling a booking, viewing credit balance) live together since
// both operate on the same cancellation/credit state machine.
@injectable()
export class AttendanceCreditsServer {
	public constructor(
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
	) {}

	// Operator-side

	public async listBySession(sessionId: number): Promise<EnrollmentAndCredit[]> {
		return this.enrollments.findBySessionId(sessionId);
	}

	// TODO: requires a cancellation-policy-window column (PRD: "e.g. >24
	// hours before session start") on operators or sessions — no such
	// column exists yet.

	// TODO: the daily token-expiration cron job (PRD UC3 edge case) has no
	// scheduling infrastructure in this project yet (no cron/job-runner
	// dependency installed).

	// Parent-side

	public async listCredits(householdId: number): Promise<EnrollmentAndCredit[]> {
		const enrollments = await this.enrollments.findByHouseholdId(householdId);
		return enrollments.filter((enrollment: EnrollmentAndCredit) => enrollment.status === 'cancelled_with_credit');
	}

	// PRD UC3: >24h before session start -> State B (credit issued, 90-day
	// expiry); otherwise -> State C (forfeited, no credit). The 24-hour
	// threshold below is hardcoded because there's no per-operator
	// cancellation-policy-window column yet (see listBySession's policy
	// TODO above) — once that column exists, this needs to read it
	// instead of a fixed constant.
	public async cancel(enrollmentId: number): Promise<EnrollmentAndCredit | null> {
		const enrollment = await this.enrollments.findById(enrollmentId);
		if (!enrollment) {
			return null;
		}

		const session = enrollment.sessionId ? await this.sessions.findById(enrollment.sessionId) : null;
		const hoursUntilStart = session ? (session.startTime.getTime() - Date.now()) / (1000 * 60 * 60) : 0;
		const withinPolicyWindow = hoursUntilStart > 24;

		const creditTokenExpiry = withinPolicyWindow ? new Date(Date.now() + CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000) : null;
		const status = withinPolicyWindow ? 'cancelled_with_credit' : 'forfeited';

		const updated = await this.enrollments.updateStatus(enrollmentId, status, creditTokenExpiry);
		if (enrollment.sessionId) {
			await this.sessions.decrementRosterCount(enrollment.sessionId);
		}

		return updated;
	}
}
