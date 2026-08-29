import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { HouseholdsServer } from '../servers/households.server';
import { SessionsServer } from '../servers/sessions.server';
import { AttendanceCreditsServer } from '../servers/attendance-credits.server';
import { BillingServer } from '../servers/billing.server';
import { RouteHandlers } from './shared/route-handlers';
import { BaseController } from './shared/base.controller';

@injectable()
export class OperatorController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer,
		@inject(TYPES.SessionsServer) private readonly sessionsServer: SessionsServer,
		@inject(TYPES.AttendanceCreditsServer) private readonly attendanceCreditsServer: AttendanceCreditsServer,
		@inject(TYPES.BillingServer) private readonly billingServer: BillingServer,
	) {
		super();
		this.internalRouter.use('/households', this.householdsRouter());
		this.internalRouter.use('/sessions', this.sessionsRouter());
		this.internalRouter.use('/attendance-credits', this.attendanceCreditsRouter());
		this.internalRouter.use('/billing', this.billingRouter());
		this.internalRouter.use('/reminders', this.remindersRouter());
		this.internalRouter.use('/autopay', this.autopayRouter());
	}

	// UC1: Household & Multi-Child Account Management

	private householdsRouter(): Router {
		const router = Router();
		router.get('/', RouteHandlers.wrap(this.listHouseholds.bind(this)));
		router.get('/:id', RouteHandlers.wrap(this.getHouseholdById.bind(this)));
		router.get('/:id/students', RouteHandlers.wrap(this.listStudents.bind(this)));
		router.post('/:id/archive', RouteHandlers.wrap(this.archiveHousehold.bind(this)));
		router.post('/:id/restore', RouteHandlers.wrap(this.restoreHousehold.bind(this)));
		// TODO: requires a co-parent/secondary-adult table (PRD UC1: "grant
		// secondary view/booking access to a co-parent via email invite") —
		// no such table exists yet.
		router.post('/:id/invite-co-parent', RouteHandlers.notImplemented);
		return router;
	}

	private async listHouseholds(_req: Request, res: Response): Promise<void> {
		const households = await this.householdsServer.listAll();
		res.json(households);
	}

	private async getHouseholdById(req: Request, res: Response): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async listStudents(req: Request, res: Response): Promise<void> {
		const students = await this.householdsServer.listStudents(Number(req.params.id));
		res.json(students);
	}

	private async archiveHousehold(req: Request, res: Response): Promise<void> {
		await this.householdsServer.archive(Number(req.params.id));
		res.status(204).end();
	}

	private async restoreHousehold(req: Request, res: Response): Promise<void> {
		await this.householdsServer.restore(Number(req.params.id));
		res.status(204).end();
	}

	// UC2: Automated Session Booking & Capacity Hard Limits

	private sessionsRouter(): Router {
		const router = Router();
		router.get('/', RouteHandlers.wrap(this.listSessions.bind(this)));
		router.get('/:id', RouteHandlers.wrap(this.getSessionById.bind(this)));
		router.get('/:id/roster', RouteHandlers.wrap(this.getRoster.bind(this)));
		router.post('/', RouteHandlers.wrap(this.createSession.bind(this)));
		router.post('/:id/cancel', RouteHandlers.wrap(this.cancelSession.bind(this)));
		return router;
	}

	private async listSessions(req: Request, res: Response): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const sessions = await this.sessionsServer.findByOperatorId(operatorId);
		res.json(sessions);
	}

	private async getSessionById(req: Request, res: Response): Promise<void> {
		const session = await this.sessionsServer.findById(Number(req.params.id));
		if (!session) {
			res.status(404).end();
			return;
		}
		res.json(session);
	}

	private async getRoster(req: Request, res: Response): Promise<void> {
		const roster = await this.sessionsServer.getRoster(Number(req.params.id));
		res.json(roster);
	}

	private async createSession(req: Request, res: Response): Promise<void> {
		const { operatorId, title, startTime, capacityLimit } = req.body as {
			operatorId: number;
			title: string;
			startTime: string;
			capacityLimit: number;
		};
		const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
		res.status(201).json(session);
	}

	private async cancelSession(req: Request, res: Response): Promise<void> {
		await this.sessionsServer.cancel(Number(req.params.id));
		res.status(204).end();
	}

	// UC3: Attendance Tracking & Automated Make-Up Credit State Machine

	private attendanceCreditsRouter(): Router {
		const router = Router();
		router.get('/session/:sessionId', RouteHandlers.wrap(this.listCreditsBySession.bind(this)));
		// TODO: requires a cancellation-policy-window column (PRD: "e.g.
		// >24 hours before session start") on operators or sessions — no
		// such column exists yet.
		router.put('/policy', RouteHandlers.notImplemented);
		// TODO: the daily token-expiration cron job (PRD UC3 edge case)
		// has no scheduling infrastructure in this project yet (no
		// cron/job-runner dependency installed) — this route would
		// trigger it manually/for testing once that exists.
		router.post('/expire-tokens', RouteHandlers.notImplemented);
		return router;
	}

	private async listCreditsBySession(req: Request, res: Response): Promise<void> {
		const enrollments = await this.attendanceCreditsServer.listBySession(Number(req.params.sessionId));
		res.json(enrollments);
	}

	// UC4: Flexible Multi-Tier Payment & Billing Engine

	private billingRouter(): Router {
		const router = Router();
		router.get('/', RouteHandlers.wrap(this.listInvoices.bind(this)));
		router.get('/:id', RouteHandlers.wrap(this.getInvoiceById.bind(this)));
		router.post('/:id/record-offline-payment', RouteHandlers.wrap(this.recordOfflinePayment.bind(this)));
		// TODO: requires a class-pack balance table (PRD Model 3: "10-class
		// pack for €130", decremented per booking) — no such table exists
		// yet.
		router.get('/class-packs/:householdId', RouteHandlers.notImplemented);
		// TODO: requires Stripe Connect integration (PRD Model 4: split
		// payouts to the operator's connected account) — no Stripe SDK is
		// installed and operators.stripe_account_id, while present, isn't
		// wired to any payment flow yet.
		router.post('/stripe/connect', RouteHandlers.notImplemented);
		return router;
	}

	private async listInvoices(req: Request, res: Response): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const invoices = await this.billingServer.findByOperatorId(operatorId);
		res.json(invoices);
	}

	private async getInvoiceById(req: Request, res: Response): Promise<void> {
		const invoice = await this.billingServer.findById(Number(req.params.id));
		if (!invoice) {
			res.status(404).end();
			return;
		}
		res.json(invoice);
	}

	private async recordOfflinePayment(req: Request, res: Response): Promise<void> {
		const invoice = await this.billingServer.recordOfflinePayment(Number(req.params.id));
		if (!invoice) {
			res.status(404).end();
			return;
		}
		res.json(invoice);
	}

	// UC5: Automated Payment Reminders & Consolidated Invoicing
	// TODO: entirely unsupported by the current schema — see
	// RemindersServer.

	private remindersRouter(): Router {
		const router = Router();
		router.put('/config', RouteHandlers.notImplemented);
		router.get('/dunning-status/:householdId', RouteHandlers.notImplemented);
		router.post('/broadcast', RouteHandlers.notImplemented);
		router.get('/broadcast/:id/delivery-receipts', RouteHandlers.notImplemented);
		return router;
	}

	// UC6: Parent Autopay Opt-Out & Operator Notice Controls
	// TODO: entirely unsupported by the current schema — see
	// AutopayServer.

	private autopayRouter(): Router {
		const router = Router();
		router.put('/policy', RouteHandlers.notImplemented);
		router.put('/policy/:householdId', RouteHandlers.notImplemented);
		return router;
	}
}
