import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { EnrollmentAndCreditRepository } from '../../repositories/enrollment-and-credit.repository';
import { SessionRepository } from '../../repositories/session.repository';
import { EnrollmentAndCredit } from '../../entities/enrollment-and-credit.entity';
import { asyncHandler } from '../shared/async-handler';

const CREDIT_EXPIRY_DAYS = 90;

// UC3: Attendance Tracking & Automated Make-Up Credit State Machine
// (parent side — cancelling a booking, viewing credit balance).
@injectable()
export class ParentAttendanceCreditsController {
	private readonly internalRouter: Router;

	public constructor(
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
	) {
		this.internalRouter = Router();
		this.internalRouter.post('/:enrollmentId/cancel', asyncHandler(this.cancel.bind(this)));
		this.internalRouter.get('/households/:householdId/credits', asyncHandler(this.listCredits.bind(this)));
	}

	public get router(): Router {
		return this.internalRouter;
	}

	private async listCredits(req: Request, res: Response): Promise<void> {
		const enrollments = await this.enrollments.findByHouseholdId(Number(req.params.householdId));
		const credits = enrollments.filter((enrollment: EnrollmentAndCredit) => enrollment.status === 'cancelled_with_credit');
		res.json(credits);
	}

	// PRD UC3: >24h before session start -> State B (credit issued, 90-day
	// expiry); otherwise -> State C (forfeited, no credit). The 24-hour
	// threshold below is hardcoded because there's no per-operator
	// cancellation-policy-window column yet (see
	// OperatorAttendanceCreditsController's policy TODO) — once that
	// column exists, this needs to read it instead of a fixed constant.
	private async cancel(req: Request, res: Response): Promise<void> {
		const enrollmentId = Number(req.params.enrollmentId);
		const enrollment = await this.enrollments.findById(enrollmentId);
		if (!enrollment) {
			res.status(404).end();
			return;
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

		res.json(updated);
	}
}
