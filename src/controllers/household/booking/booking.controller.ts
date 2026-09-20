import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { SessionsServer } from '../../../servers/sessions.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { BookingConflictError } from '../../../servers/types/sessions.server.types';
import { BookSessionBody } from './types/book-session-body.type';
import { BookSessionResponse } from './types/book-session-response.type';
import { ListOwnEnrollmentsResponse } from './types/list-own-enrollments-response.type';
import { toPublic } from '../../../utils/to-public';

// UC2: Automated Session Booking & Capacity Hard Limits
@injectable()
export class BookingController extends BaseController {
	public constructor(@inject(TYPES.SessionsServer) private readonly sessionsServer: SessionsServer) {
		super();

		this.internalRouter.get('/sessions', RouteHandlers.notImplemented); // TODO: browse-by-availability listing, not yet designed

		/**
		 * @openapi
		 * /api/household/booking/sessions/{sessionId}/book:
		 *   post:
		 *     summary: Book a session
		 *     tags: [Household - Booking]
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
		 *       404: { description: Session, student, or household not found }
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
		this.internalRouter.post('/sessions/:sessionId/book', RouteHandlers.wrapOneParamBody('sessionId', this.book.bind(this)));

		/**
		 * @openapi
		 * /api/household/booking/households/{householdId}/enrollments:
		 *   get:
		 *     summary: List own household's enrollments
		 *     tags: [Household - Booking]
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
		 *       404: { description: Household not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/households/:householdId/enrollments', RouteHandlers.wrapOneParam('householdId', this.listEnrollments.bind(this)));

		// TODO: requires a real wait-list (PRD: "queue-based wait-list ordered strictly by timestamp", automated promotion with a
		// time-sensitive claim window on cancellation) - status is a free-text column with no queue-position or claim-deadline tracking.
		this.internalRouter.get('/sessions/:sessionId/waitlist', RouteHandlers.notImplemented);

		this.internalRouter.post('/waitlist/:enrollmentId/claim', RouteHandlers.notImplemented);
	}

	private async listEnrollments(householdId: string): Promise<Result<ListOwnEnrollmentsResponse>> {
		const enrollments = await this.sessionsServer.listEnrollments(Number(householdId));
		if (!enrollments) {
			return Results.notFound();
		}
		return Results.ok(enrollments.map(toPublic));
	}

	private async book(sessionIdParam: string, body: BookSessionBody): Promise<Result<BookSessionResponse>> {
		const sessionId = Number(sessionIdParam);
		const { studentId, householdId } = body;

		try {
			const result = await this.sessionsServer.book(sessionId, studentId, householdId);
			if (!result) {
				return Results.notFound();
			}
			return Results.created(toPublic(result));
		} catch (error) {
			if (error instanceof BookingConflictError) {
				return Results.conflict(error.message, { waitlisted: error.waitlisted });
			}
			throw error;
		}
	}
}
