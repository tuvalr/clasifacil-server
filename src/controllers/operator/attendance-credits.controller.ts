import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { EnrollmentAndCreditRepository } from '../../repositories/enrollment-and-credit.repository';
import { notImplemented } from '../shared/not-implemented';

// UC3: Attendance Tracking & Automated Make-Up Credit State Machine
// (operator side — configuring policy, viewing state).
@injectable()
export class OperatorAttendanceCreditsController {
	private readonly internalRouter: Router;

	public constructor(@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository) {
		this.internalRouter = Router();
		this.internalRouter.get('/session/:sessionId', this.listBySession.bind(this));
		// TODO: requires a cancellation-policy-window column (PRD: "e.g.
		// >24 hours before session start") on operators or sessions — no
		// such column exists yet.
		this.internalRouter.put('/policy', notImplemented);
		// TODO: the daily token-expiration cron job (PRD UC3 edge case)
		// has no scheduling infrastructure in this project yet (no
		// cron/job-runner dependency installed) — this route would
		// trigger it manually/for testing once that exists.
		this.internalRouter.post('/expire-tokens', notImplemented);
	}

	public get router(): Router {
		return this.internalRouter;
	}

	private async listBySession(req: Request, res: Response): Promise<void> {
		const enrollments = await this.enrollments.findBySessionId(Number(req.params.sessionId));
		res.json(enrollments);
	}
}
