import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { HouseholdsServer } from '../../servers/households.server';
import { SessionsServer } from '../../servers/sessions.server';
import { AttendanceCreditsServer } from '../../servers/attendance-credits.server';
import { BillingServer } from '../../servers/billing.server';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';
import { ListHouseholdsResponse } from './types/list-households-response.type';
import { GetHouseholdResponse } from './types/get-household-response.type';
import { ListHouseholdStudentsResponse } from './types/list-household-students-response.type';
import { ListSessionsQuery } from './types/list-sessions-query.type';
import { ListSessionsResponse } from './types/list-sessions-response.type';
import { GetSessionResponse } from './types/get-session-response.type';
import { GetSessionRosterResponse } from './types/get-session-roster-response.type';
import { CreateSessionBody } from './types/create-session-body.type';
import { CreateSessionResponse } from './types/create-session-response.type';
import { ListSessionCreditsResponse } from './types/list-session-credits-response.type';
import { ListOperatorInvoicesQuery } from './types/list-operator-invoices-query.type';
import { ListOperatorInvoicesResponse } from './types/list-operator-invoices-response.type';
import { GetInvoiceResponse } from './types/get-invoice-response.type';
import { RecordOfflinePaymentResponse } from './types/record-offline-payment-response.type';

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

		/**
		 * @openapi
		 * /api/operator/households:
		 *   get:
		 *     summary: List households
		 *     tags: [Operator - Households]
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Household' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/', RouteHandlers.wrap(this.listHouseholds.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}:
		 *   get:
		 *     summary: Get household by ID
		 *     tags: [Operator - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Household' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/:id', RouteHandlers.wrap(this.getHouseholdById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}/students:
		 *   get:
		 *     summary: List a household's students
		 *     tags: [Operator - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Student' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/:id/students', RouteHandlers.wrap(this.listStudents.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}/archive:
		 *   post:
		 *     summary: Archive a household
		 *     tags: [Operator - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Archived }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/archive', RouteHandlers.wrap(this.archiveHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}/restore:
		 *   post:
		 *     summary: Restore an archived household
		 *     tags: [Operator - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Restored }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/restore', RouteHandlers.wrap(this.restoreHousehold.bind(this)));
		// TODO: requires a co-parent/secondary-adult table (PRD UC1: "grant
		// secondary view/booking access to a co-parent via email invite") —
		// no such table exists yet.
		router.post('/:id/invite-co-parent', RouteHandlers.notImplemented);
		return router;
	}

	private async listHouseholds(_req: Request, res: Response<ListHouseholdsResponse>): Promise<void> {
		const households = await this.householdsServer.listAll();
		res.json(households);
	}

	private async getHouseholdById(req: Request<{ id: string }>, res: Response<GetHouseholdResponse>): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async listStudents(req: Request<{ id: string }>, res: Response<ListHouseholdStudentsResponse>): Promise<void> {
		const students = await this.householdsServer.listStudents(Number(req.params.id));
		res.json(students);
	}

	private async archiveHousehold(req: Request<{ id: string }>, res: Response): Promise<void> {
		await this.householdsServer.archive(Number(req.params.id));
		res.status(204).end();
	}

	private async restoreHousehold(req: Request<{ id: string }>, res: Response): Promise<void> {
		await this.householdsServer.restore(Number(req.params.id));
		res.status(204).end();
	}

	// UC2: Automated Session Booking & Capacity Hard Limits

	private sessionsRouter(): Router {
		const router = Router();

		/**
		 * @openapi
		 * /api/operator/sessions:
		 *   get:
		 *     summary: List sessions for an operator
		 *     tags: [Operator - Sessions]
		 *     parameters:
		 *       - in: query
		 *         name: operatorId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Session' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/', RouteHandlers.wrap(this.listSessions.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions/{id}:
		 *   get:
		 *     summary: Get session by ID
		 *     tags: [Operator - Sessions]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/:id', RouteHandlers.wrap(this.getSessionById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions/{id}/roster:
		 *   get:
		 *     summary: Get a session's roster
		 *     tags: [Operator - Sessions]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/EnrollmentAndCredit' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/:id/roster', RouteHandlers.wrap(this.getRoster.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions:
		 *   post:
		 *     summary: Create a session
		 *     tags: [Operator - Sessions]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [operatorId, title, startTime, capacityLimit]
		 *             properties:
		 *               operatorId: { type: integer }
		 *               title: { type: string }
		 *               startTime: { type: string, format: date-time }
		 *               capacityLimit: { type: integer }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/', RouteHandlers.wrap(this.createSession.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions/{id}/cancel:
		 *   post:
		 *     summary: Cancel a session
		 *     tags: [Operator - Sessions]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Cancelled }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/cancel', RouteHandlers.wrap(this.cancelSession.bind(this)));

		return router;
	}

	private async listSessions(req: Request<unknown, ListSessionsResponse, unknown, ListSessionsQuery>, res: Response<ListSessionsResponse>): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const sessions = await this.sessionsServer.findByOperatorId(operatorId);
		res.json(sessions);
	}

	private async getSessionById(req: Request<{ id: string }>, res: Response<GetSessionResponse>): Promise<void> {
		const session = await this.sessionsServer.findById(Number(req.params.id));
		if (!session) {
			res.status(404).end();
			return;
		}
		res.json(session);
	}

	private async getRoster(req: Request<{ id: string }>, res: Response<GetSessionRosterResponse>): Promise<void> {
		const roster = await this.sessionsServer.getRoster(Number(req.params.id));
		res.json(roster);
	}

	private async createSession(req: Request<unknown, CreateSessionResponse, CreateSessionBody>, res: Response<CreateSessionResponse>): Promise<void> {
		const { operatorId, title, startTime, capacityLimit } = req.body;
		const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
		res.status(201).json(session);
	}

	private async cancelSession(req: Request<{ id: string }>, res: Response): Promise<void> {
		await this.sessionsServer.cancel(Number(req.params.id));
		res.status(204).end();
	}

	// UC3: Attendance Tracking & Automated Make-Up Credit State Machine

	private attendanceCreditsRouter(): Router {
		const router = Router();

		/**
		 * @openapi
		 * /api/operator/attendance-credits/session/{sessionId}:
		 *   get:
		 *     summary: List enrollments/credits for a session
		 *     tags: [Operator - Attendance Credits]
		 *     parameters:
		 *       - in: path
		 *         name: sessionId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/EnrollmentAndCredit' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/session/:sessionId', RouteHandlers.wrap(this.listCreditsBySession.bind(this)));

		// TODO: requires a cancellation-policy-window column (PRD: "e.g. >24 hours before session start") on operators or sessions —
		// no such column exists yet.
		router.put('/policy', RouteHandlers.notImplemented);

		// TODO: the daily token-expiration cron job (PRD UC3 edge case) has no scheduling infrastructure in this project yet (no
		// cron/job-runner dependency installed) — this route would trigger it manually/for testing once that exists.
		router.post('/expire-tokens', RouteHandlers.notImplemented);

		return router;
	}

	private async listCreditsBySession(req: Request<{ sessionId: string }>, res: Response<ListSessionCreditsResponse>): Promise<void> {
		const enrollments = await this.attendanceCreditsServer.listBySession(Number(req.params.sessionId));
		res.json(enrollments);
	}

	// UC4: Flexible Multi-Tier Payment & Billing Engine

	private billingRouter(): Router {
		const router = Router();

		/**
		 * @openapi
		 * /api/operator/billing:
		 *   get:
		 *     summary: List invoices for an operator
		 *     tags: [Operator - Billing]
		 *     parameters:
		 *       - in: query
		 *         name: operatorId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/InvoiceAndPayment' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/', RouteHandlers.wrap(this.listInvoices.bind(this)));

		/**
		 * @openapi
		 * /api/operator/billing/{id}:
		 *   get:
		 *     summary: Get invoice by ID
		 *     tags: [Operator - Billing]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/InvoiceAndPayment' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/:id', RouteHandlers.wrap(this.getInvoiceById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/billing/{id}/record-offline-payment:
		 *   post:
		 *     summary: Record an offline (cash) payment
		 *     tags: [Operator - Billing]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/InvoiceAndPayment' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/record-offline-payment', RouteHandlers.wrap(this.recordOfflinePayment.bind(this)));

		// TODO: requires a class-pack balance table (PRD Model 3: "10-class pack for €130", decremented per booking) — no such table exists yet.
		router.get('/class-packs/:householdId', RouteHandlers.notImplemented);

		// TODO: requires Stripe Connect integration (PRD Model 4: split payouts to the operator's connected account) — no Stripe SDK is
		// installed and operators.stripe_account_id, while present, isn't wired to any payment flow yet.
		router.post('/stripe/connect', RouteHandlers.notImplemented);

		return router;
	}

	private async listInvoices(req: Request<unknown, ListOperatorInvoicesResponse, unknown, ListOperatorInvoicesQuery>, res: Response<ListOperatorInvoicesResponse>): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const invoices = await this.billingServer.findByOperatorId(operatorId);
		res.json(invoices);
	}

	private async getInvoiceById(req: Request<{ id: string }>, res: Response<GetInvoiceResponse>): Promise<void> {
		const invoice = await this.billingServer.findById(Number(req.params.id));
		if (!invoice) {
			res.status(404).end();
			return;
		}
		res.json(invoice);
	}

	private async recordOfflinePayment(req: Request<{ id: string }>, res: Response<RecordOfflinePaymentResponse>): Promise<void> {
		const invoice = await this.billingServer.recordOfflinePayment(Number(req.params.id));
		if (!invoice) {
			res.status(404).end();
			return;
		}
		res.json(invoice);
	}

	// UC5: Automated Payment Reminders & Consolidated Invoicing
	// TODO: entirely unsupported by the current schema — see RemindersServer.

	private remindersRouter(): Router {
		const router = Router();
		router.put('/config', RouteHandlers.notImplemented);
		router.get('/dunning-status/:householdId', RouteHandlers.notImplemented);
		router.post('/broadcast', RouteHandlers.notImplemented);
		router.get('/broadcast/:id/delivery-receipts', RouteHandlers.notImplemented);
		return router;
	}

	// UC6: Parent Autopay Opt-Out & Operator Notice Controls
	// TODO: entirely unsupported by the current schema — see AutopayServer.

	private autopayRouter(): Router {
		const router = Router();
		router.put('/policy', RouteHandlers.notImplemented);
		router.put('/policy/:householdId', RouteHandlers.notImplemented);
		return router;
	}
}
