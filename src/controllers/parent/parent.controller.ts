import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { HouseholdsServer } from '../../servers/households.server';
import { SessionsServer } from '../../servers/sessions.server';
import { AttendanceCreditsServer } from '../../servers/attendance-credits.server';
import { BillingServer } from '../../servers/billing.server';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';
import { GetOwnHouseholdResponse } from './types/get-own-household-response.type';
import { UpdateHouseholdBody } from './types/update-household-body.type';
import { UpdateHouseholdResponse } from './types/update-household-response.type';
import { ListOwnStudentsResponse } from './types/list-own-students-response.type';
import { CreateStudentBody } from './types/create-student-body.type';
import { CreateStudentResponse } from './types/create-student-response.type';
import { UpdateStudentBody } from './types/update-student-body.type';
import { UpdateStudentResponse } from './types/update-student-response.type';
import { BookSessionBody } from './types/book-session-body.type';
import { BookSessionResponse } from './types/book-session-response.type';
import { ListOwnEnrollmentsResponse } from './types/list-own-enrollments-response.type';
import { ListOwnCreditsResponse } from './types/list-own-credits-response.type';
import { CancelEnrollmentResponse } from './types/cancel-enrollment-response.type';
import { ListOwnInvoicesResponse } from './types/list-own-invoices-response.type';

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

		/**
		 * @openapi
		 * /api/parent/households/{id}:
		 *   get:
		 *     summary: Get own household
		 *     tags: [Parent - Households]
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
		 * /api/parent/households/{id}:
		 *   put:
		 *     summary: Update own household
		 *     tags: [Parent - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             properties:
		 *               name: { type: string }
		 *               email: { type: string }
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
		router.put('/:id', RouteHandlers.wrap(this.updateHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/parent/households/{id}/students:
		 *   get:
		 *     summary: List own students
		 *     tags: [Parent - Households]
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
		 * /api/parent/households/{id}/students:
		 *   post:
		 *     summary: Add a student to own household
		 *     tags: [Parent - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [fullName]
		 *             properties:
		 *               fullName: { type: string }
		 *               dateOfBirth: { type: string, format: date-time, nullable: true }
		 *               notes: { type: string, nullable: true }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Student' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/students', RouteHandlers.wrap(this.createStudent.bind(this)));

		/**
		 * @openapi
		 * /api/parent/households/{id}/students/{studentId}:
		 *   put:
		 *     summary: Update own student
		 *     tags: [Parent - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: studentId
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             properties:
		 *               fullName: { type: string }
		 *               notes: { type: string, nullable: true }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Student' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.put('/:id/students/:studentId', RouteHandlers.wrap(this.updateStudent.bind(this)));

		// PRD UC1 edge case: "Archiving a Child Profile" — retain historical attendance/invoice logs, remove from active roster
		// selectors. This is exactly PostgresHandler's soft-delete, so it IS implemented.
		/**
		 * @openapi
		 * /api/parent/households/{id}/students/{studentId}/archive:
		 *   post:
		 *     summary: Archive own student
		 *     tags: [Parent - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: studentId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Archived }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/students/:studentId/archive', RouteHandlers.wrap(this.archiveStudent.bind(this)));

		// TODO: requires a co-parent/secondary-adult table (PRD: "grant secondary view/booking access to a co-parent or caregiver via
		// email invite") — no such table exists yet.
		router.get('/:id/co-parents', RouteHandlers.notImplemented);

		router.post('/:id/co-parents/invite', RouteHandlers.notImplemented);

		return router;
	}

	private async getHouseholdById(req: Request<{ id: string }>, res: Response<GetOwnHouseholdResponse>): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async updateHousehold(req: Request<{ id: string }, UpdateHouseholdResponse, UpdateHouseholdBody>, res: Response<UpdateHouseholdResponse>): Promise<void> {
		const { name, email } = req.body;
		const household = await this.householdsServer.update(Number(req.params.id), { name, email });
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async listStudents(req: Request<{ id: string }>, res: Response<ListOwnStudentsResponse>): Promise<void> {
		const students = await this.householdsServer.listStudents(Number(req.params.id));
		res.json(students);
	}

	private async createStudent(req: Request<{ id: string }, CreateStudentResponse, CreateStudentBody>, res: Response<CreateStudentResponse>): Promise<void> {
		const { fullName, dateOfBirth, notes } = req.body;
		const student = await this.householdsServer.createStudent({
			householdId: Number(req.params.id),
			fullName,
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
			notes,
		});
		res.status(201).json(student);
	}

	private async updateStudent(req: Request<{ id: string; studentId: string }, UpdateStudentResponse, UpdateStudentBody>, res: Response<UpdateStudentResponse>): Promise<void> {
		const { fullName, notes } = req.body;
		const student = await this.householdsServer.updateStudent(Number(req.params.studentId), { fullName, notes });
		if (!student) {
			res.status(404).end();
			return;
		}
		res.json(student);
	}

	private async archiveStudent(req: Request<{ id: string; studentId: string }>, res: Response): Promise<void> {
		await this.householdsServer.archiveStudent(Number(req.params.studentId));
		res.status(204).end();
	}

	// UC2: Automated Session Booking & Capacity Hard Limits

	private bookingRouter(): Router {
		const router = Router();
		router.get('/sessions', RouteHandlers.notImplemented); // TODO: browse-by-availability listing, not yet designed

		/**
		 * @openapi
		 * /api/parent/booking/sessions/{sessionId}/book:
		 *   post:
		 *     summary: Book a session
		 *     tags: [Parent - Booking]
		 *     parameters:
		 *       - in: path
		 *         name: sessionId
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [studentId, householdId]
		 *             properties:
		 *               studentId: { type: integer }
		 *               householdId: { type: integer }
		 *     responses:
		 *       201:
		 *         description: Booked
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/EnrollmentAndCredit' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Session not found }
		 *       409:
		 *         description: Session at capacity
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 error: { type: string }
		 *                 waitlisted: { type: boolean }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/sessions/:sessionId/book', RouteHandlers.wrap(this.book.bind(this)));

		/**
		 * @openapi
		 * /api/parent/booking/households/{householdId}/enrollments:
		 *   get:
		 *     summary: List own household's enrollments
		 *     tags: [Parent - Booking]
		 *     parameters:
		 *       - in: path
		 *         name: householdId
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
		router.get('/households/:householdId/enrollments', RouteHandlers.wrap(this.listEnrollments.bind(this)));

		// TODO: requires a real wait-list (PRD: "queue-based wait-list ordered strictly by timestamp", automated promotion with a
		// time-sensitive claim window on cancellation) — status is a free-text column with no queue-position or claim-deadline tracking.
		router.get('/sessions/:sessionId/waitlist', RouteHandlers.notImplemented);

		router.post('/waitlist/:enrollmentId/claim', RouteHandlers.notImplemented);

		return router;
	}

	private async listEnrollments(req: Request<{ householdId: string }>, res: Response<ListOwnEnrollmentsResponse>): Promise<void> {
		const enrollments = await this.sessionsServer.listEnrollments(Number(req.params.householdId));
		res.json(enrollments);
	}

	private async book(req: Request<{ sessionId: string }, BookSessionResponse, BookSessionBody>, res: Response<BookSessionResponse>): Promise<void> {
		const sessionId = Number(req.params.sessionId);
		const { studentId, householdId } = req.body;

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

		/**
		 * @openapi
		 * /api/parent/attendance-credits/{enrollmentId}/cancel:
		 *   post:
		 *     summary: Cancel an enrollment
		 *     tags: [Parent - Attendance Credits]
		 *     parameters:
		 *       - in: path
		 *         name: enrollmentId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/EnrollmentAndCredit' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:enrollmentId/cancel', RouteHandlers.wrap(this.cancelEnrollment.bind(this)));

		/**
		 * @openapi
		 * /api/parent/attendance-credits/households/{householdId}/credits:
		 *   get:
		 *     summary: List own household's credits
		 *     tags: [Parent - Attendance Credits]
		 *     parameters:
		 *       - in: path
		 *         name: householdId
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
		router.get('/households/:householdId/credits', RouteHandlers.wrap(this.listCredits.bind(this)));

		return router;
	}

	private async listCredits(req: Request<{ householdId: string }>, res: Response<ListOwnCreditsResponse>): Promise<void> {
		const credits = await this.attendanceCreditsServer.listCredits(Number(req.params.householdId));
		res.json(credits);
	}

	private async cancelEnrollment(req: Request<{ enrollmentId: string }>, res: Response<CancelEnrollmentResponse>): Promise<void> {
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

		/**
		 * @openapi
		 * /api/parent/billing/households/{householdId}/invoices:
		 *   get:
		 *     summary: List own household's invoices
		 *     tags: [Parent - Billing]
		 *     parameters:
		 *       - in: path
		 *         name: householdId
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
		router.get('/households/:householdId/invoices', RouteHandlers.wrap(this.listInvoices.bind(this)));

		// Model 1: Pay-Per-Class (Drop-in) card checkout. TODO: requires a payment-processor integration (Stripe) — no Stripe SDK is
		// installed and invoices_and_payments.stripe_charge_id, while present, has no write path yet.
		router.post('/invoices/:id/pay', RouteHandlers.notImplemented);

		// TODO: requires a class-pack balance table (PRD Model 3) — no such table exists yet.
		router.get('/households/:householdId/class-packs', RouteHandlers.notImplemented);

		router.post('/households/:householdId/class-packs/purchase', RouteHandlers.notImplemented);

		return router;
	}

	private async listInvoices(req: Request<{ householdId: string }>, res: Response<ListOwnInvoicesResponse>): Promise<void> {
		const invoices = await this.billingServer.findByHouseholdId(Number(req.params.householdId));
		res.json(invoices);
	}

	// UC6: Parent Autopay Opt-Out & Operator Notice Controls
	//  TODO: entirely unsupported by the current schema — see AutopayServer.

	private autopayRouter(): Router {
		const router = Router();
		router.get('/households/:householdId/autopay', RouteHandlers.notImplemented);
		router.put('/households/:householdId/autopay', RouteHandlers.notImplemented);
		return router;
	}
}
