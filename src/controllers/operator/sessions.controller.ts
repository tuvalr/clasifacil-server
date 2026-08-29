import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { SessionRepository } from '../../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../../repositories/enrollment-and-credit.repository';
import { asyncHandler } from '../shared/async-handler';

// UC2: Automated Session Booking & Capacity Hard Limits (operator side —
// creating/managing sessions; booking itself is the parent side, see
// ParentBookingController).
@injectable()
export class OperatorSessionsController {
	private readonly internalRouter: Router;

	public constructor(
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
	) {
		this.internalRouter = Router();
		this.internalRouter.get('/', asyncHandler(this.list.bind(this)));
		this.internalRouter.get('/:id', asyncHandler(this.getById.bind(this)));
		this.internalRouter.get('/:id/roster', asyncHandler(this.roster.bind(this)));
		this.internalRouter.post('/', asyncHandler(this.create.bind(this)));
		this.internalRouter.post('/:id/cancel', asyncHandler(this.cancel.bind(this)));
	}

	public get router(): Router {
		return this.internalRouter;
	}

	private async list(req: Request, res: Response): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const sessions = await this.sessions.findByOperatorId(operatorId);
		res.json(sessions);
	}

	private async getById(req: Request, res: Response): Promise<void> {
		const session = await this.sessions.findById(Number(req.params.id));
		if (!session) {
			res.status(404).end();
			return;
		}
		res.json(session);
	}

	private async roster(req: Request, res: Response): Promise<void> {
		const roster = await this.enrollments.findBySessionId(Number(req.params.id));
		res.json(roster);
	}

	private async create(req: Request, res: Response): Promise<void> {
		const { operatorId, title, startTime, capacityLimit } = req.body as {
			operatorId: number;
			title: string;
			startTime: string;
			capacityLimit: number;
		};
		const session = await this.sessions.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
		res.status(201).json(session);
	}

	// PRD UC3 edge case: "Operator Cancels the Class" — must issue a
	// make-up token to ALL enrolled households regardless of the standard
	// cancellation policy window, and log an audit trail. The roster
	// lookup and session cancel are wired; token issuance is not, since
	// there's no cancellation-policy-window config on operators/sessions
	// yet, and audit_logs has no is_deleted-style "which credit rule
	// applied" linkage designed in.
	private async cancel(req: Request, res: Response): Promise<void> {
		const sessionId = Number(req.params.id);
		await this.sessions.cancel(sessionId);
		// TODO: issue make-up tokens to all enrolled households (roster =
		// this.enrollments.findBySessionId(sessionId)) and write an
		// audit_logs entry — requires the credit-issuance logic from UC3
		// and a defined audit-log write path, neither implemented yet.
		res.status(204).end();
	}
}
