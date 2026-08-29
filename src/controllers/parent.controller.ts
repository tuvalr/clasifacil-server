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
export class ParentController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer,
		@inject(TYPES.SessionsServer) private readonly sessionsServer: SessionsServer,
		@inject(TYPES.AttendanceCreditsServer) private readonly attendanceCreditsServer: AttendanceCreditsServer,
		@inject(TYPES.BillingServer) private readonly billingServer: BillingServer,
	) {
		super();
		this.internalRouter.use('/households', this.householdsRouter());
		this.internalRouter.use('/booking', this.bookingRouter());
		this.internalRouter.use('/attendance-credits', this.attendanceCreditsRouter());
		this.internalRouter.use('/billing', this.billingRouter());
		this.internalRouter.use('/autopay', this.autopayRouter());
	}

	// UC1: Household & Multi-Child Account Management

	private householdsRouter(): Router {
		const router = Router();
		router.get('/:id', RouteHandlers.wrap(this.getHouseholdById.bind(this)));
		router.put('/:id', RouteHandlers.wrap(this.updateHousehold.bind(this)));
		router.get('/:id/students', RouteHandlers.wrap(this.listStudents.bind(this)));
		router.post('/:id/students', RouteHandlers.wrap(this.createStudent.bind(this)));
		router.put('/:id/students/:studentId', RouteHandlers.wrap(this.updateStudent.bind(this)));
		// PRD UC1 edge case: "Archiving a Child Profile" — retain
		// historical attendance/invoice logs, remove from active roster
		// selectors. This is exactly PostgresHandler's soft-delete, so it
		// IS implemented.
		router.post('/:id/students/:studentId/archive', RouteHandlers.wrap(this.archiveStudent.bind(this)));
		// TODO: requires a co-parent/secondary-adult table (PRD: "grant
		// secondary view/booking access to a co-parent or caregiver via
		// email invite") — no such table exists yet.
		router.get('/:id/co-parents', RouteHandlers.notImplemented);
		router.post('/:id/co-parents/invite', RouteHandlers.notImplemented);
		return router;
	}

	private async getHouseholdById(req: Request, res: Response): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async updateHousehold(req: Request, res: Response): Promise<void> {
		const { name, email } = req.body as { name?: string; email?: string };
		const household = await this.householdsServer.update(Number(req.params.id), { name, email });
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

	private async createStudent(req: Request, res: Response): Promise<void> {
		const { fullName, dateOfBirth, notes } = req.body as { fullName: string; dateOfBirth: string | null; notes: string | null };
		const student = await this.householdsServer.createStudent({
			householdId: Number(req.params.id),
			fullName,
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
			notes,
		});
		res.status(201).json(student);
	}

	private async updateStudent(req: Request, res: Response): Promise<void> {
		const { fullName, notes } = req.body as { fullName?: string; notes?: string | null };
		const student = await this.householdsServer.updateStudent(Number(req.params.studentId), { fullName, notes });
		if (!student) {
			res.status(404).end();
			return;
		}
		res.json(student);
	}

	private async archiveStudent(req: Request, res: Response): Promise<void> {
		await this.householdsServer.archiveStudent(Number(req.params.studentId));
		res.status(204).end();
	}

	// UC2: Automated Session Booking & Capacity Hard Limits

	private bookingRouter(): Router {
		const router = Router();
		router.get('/sessions', RouteHandlers.notImplemented); // TODO: browse-by-availability listing, not yet designed
		router.post('/sessions/:sessionId/book', RouteHandlers.wrap(this.book.bind(this)));
		router.get('/households/:householdId/enrollments', RouteHandlers.wrap(this.listEnrollments.bind(this)));
		// TODO: requires a real waitlist (PRD: "queue-based waitlist
		// ordered strictly by timestamp", automated promotion with a
		// time-sensitive claim window on cancellation) — status is a free
		// -text column with no queue-position or claim-deadline tracking.
		router.get('/sessions/:sessionId/waitlist', RouteHandlers.notImplemented);
		router.post('/waitlist/:enrollmentId/claim', RouteHandlers.notImplemented);
		return router;
	}

	private async listEnrollments(req: Request, res: Response): Promise<void> {
		const enrollments = await this.sessionsServer.listEnrollments(Number(req.params.householdId));
		res.json(enrollments);
	}

	private async book(req: Request, res: Response): Promise<void> {
		const sessionId = Number(req.params.sessionId);
		const { studentId, householdId } = req.body as { studentId: number; householdId: number };

		const result = await this.sessionsServer.book(sessionId, studentId, householdId);
		if (!result) {
			res.status(404).end();
			return;
		}
		if ('conflict' in result) {
			res.status(409).json({ error: 'Session at capacity', waitlisted: result.waitlisted });
			return;
		}
		res.status(201).json(result);
	}

	// UC3: Attendance Tracking & Automated Make-Up Credit State Machine

	private attendanceCreditsRouter(): Router {
		const router = Router();
		router.post('/:enrollmentId/cancel', RouteHandlers.wrap(this.cancelEnrollment.bind(this)));
		router.get('/households/:householdId/credits', RouteHandlers.wrap(this.listCredits.bind(this)));
		return router;
	}

	private async listCredits(req: Request, res: Response): Promise<void> {
		const credits = await this.attendanceCreditsServer.listCredits(Number(req.params.householdId));
		res.json(credits);
	}

	private async cancelEnrollment(req: Request, res: Response): Promise<void> {
		const enrollmentId = Number(req.params.enrollmentId);
		const updated = await this.attendanceCreditsServer.cancel(enrollmentId);
		if (!updated) {
			res.status(404).end();
			return;
		}
		res.json(updated);
	}

	// UC4: Flexible Multi-Tier Payment & Billing Engine

	private billingRouter(): Router {
		const router = Router();
		router.get('/households/:householdId/invoices', RouteHandlers.wrap(this.listInvoices.bind(this)));
		// Model 1: Pay-Per-Class (Drop-in) card checkout. TODO: requires a
		// payment-processor integration (Stripe) — no Stripe SDK is
		// installed and invoices_and_payments.stripe_charge_id, while
		// present, has no write path yet.
		router.post('/invoices/:id/pay', RouteHandlers.notImplemented);
		// TODO: requires a class-pack balance table (PRD Model 3) — no
		// such table exists yet.
		router.get('/households/:householdId/class-packs', RouteHandlers.notImplemented);
		router.post('/households/:householdId/class-packs/purchase', RouteHandlers.notImplemented);
		return router;
	}

	private async listInvoices(req: Request, res: Response): Promise<void> {
		const invoices = await this.billingServer.findByHouseholdId(Number(req.params.householdId));
		res.json(invoices);
	}

	// UC6: Parent Autopay Opt-Out & Operator Notice Controls
	// TODO: entirely unsupported by the current schema — see
	// AutopayServer.

	private autopayRouter(): Router {
		const router = Router();
		router.get('/households/:householdId/autopay', RouteHandlers.notImplemented);
		router.put('/households/:householdId/autopay', RouteHandlers.notImplemented);
		return router;
	}
}
