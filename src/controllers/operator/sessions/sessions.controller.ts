import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { SessionsServer } from '../../../servers/sessions.server';
import { PlainSessionNotAllowedError } from '../../../servers/types/sessions.server.types';
import { SessionAttendanceServer } from '../../../servers/session-attendance.server';
import { SessionAttendance } from '../../../entities/session-attendance.entity';
import { ValidationError } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { ListSessionsQuery } from './types/list-sessions-query.type';
import { ListSessionsResponse } from './types/list-sessions-response.type';
import { GetSessionResponse } from './types/get-session-response.type';
import { GetSessionRosterResponse } from './types/get-session-roster-response.type';
import { CreateSessionBody } from './types/create-session-body.type';
import { CreateSessionResponse } from './types/create-session-response.type';
import { RescheduleSessionBody } from './types/reschedule-session-body.type';
import { SessionAttendanceBody } from './types/session-attendance-body.type';
import { SessionAttendanceResponse, SessionAttendanceResponseItem } from './types/session-attendance-response.type';
import { toPublic } from '../../../utils/to-public';

// UC2: Automated Session Booking & Capacity Hard Limits
@injectable()
export class SessionsController extends BaseController {
	public constructor(
		@inject(TYPES.SessionsServer) private readonly sessionsServer: SessionsServer,
		@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendanceServer: SessionAttendanceServer,
	) {
		super();

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
		 *       404: { description: Operator not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/', RouteHandlers.wrapNoParamsQuery(this.listSessions.bind(this)));

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
		this.internalRouter.get('/:id', RouteHandlers.wrapOneParam('id', this.getSessionById.bind(this)));

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
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 enrollments: { type: array, items: { $ref: '#/components/schemas/EnrollmentAndCredit' } }
		 *                 classMemberStudentIds: { type: array, items: { type: integer } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/roster', RouteHandlers.wrapOneParam('id', this.getRoster.bind(this)));

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
		 *       404: { description: Operator not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/', RouteHandlers.wrapNoParamsBody(this.createSession.bind(this)));

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
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/cancel', RouteHandlers.wrapOneParam('id', this.cancelSession.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions/{id}/reschedule:
		 *   patch:
		 *     summary: Reschedule a single session occurrence
		 *     description: Leaves the class definition and every other occurrence untouched.
		 *     tags: [Operator - Sessions]
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
		 *             required: [startTime]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
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
		this.internalRouter.patch('/:id/reschedule', RouteHandlers.wrapOneParamBody('id', this.rescheduleSession.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions/{id}/attendance:
		 *   get:
		 *     summary: Get recorded attendance for a true one-off session
		 *     description: Returns only recorded rows - a student with no session_attendance row simply doesn't appear (not synthesized as not_recorded here).
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
		 *             schema:
		 *               type: array
		 *               items:
		 *                 type: object
		 *                 properties:
		 *                   studentId: { type: integer }
		 *                   status: { type: string, enum: [present, absent, approved_absent] }
		 *             example:
		 *               - studentId: 100
		 *                 status: present
		 *               - studentId: 101
		 *                 status: absent
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/attendance', RouteHandlers.wrapOneParam('id', this.getAttendance.bind(this)));

		/**
		 * @openapi
		 * /api/operator/sessions/{id}/attendance:
		 *   put:
		 *     summary: Record or correct attendance for a true one-off session
		 *     description: >
		 *       Upserts one row per given student - marking again updates the existing record, never duplicates it.
		 *       Rejected with 400 if the session's startTime is still in the future.
		 *     tags: [Operator - Sessions]
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
		 *             required: [attendance]
		 *             properties:
		 *               attendance:
		 *                 type: array
		 *                 items:
		 *                   type: object
		 *                   properties:
		 *                     studentId: { type: integer }
		 *                     status: { type: string, enum: [present, absent, approved_absent] }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: array
		 *               items:
		 *                 type: object
		 *                 properties:
		 *                   studentId: { type: integer }
		 *                   status: { type: string, enum: [present, absent, approved_absent] }
		 *             example:
		 *               - studentId: 100
		 *                 status: present
		 *               - studentId: 101
		 *                 status: absent
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id/attendance', RouteHandlers.wrapOneParamBody('id', this.recordAttendance.bind(this)));
	}

	private async listSessions(query: ListSessionsQuery): Promise<Result<ListSessionsResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('Operator is required');
		}

		const sessions = await this.sessionsServer.findByOperatorId(operatorId);
		if (!sessions) {
			return Results.notFound();
		}
		return Results.ok(sessions.map(toPublic));
	}

	private async getSessionById(id: string): Promise<Result<GetSessionResponse>> {
		const session = await this.sessionsServer.findById(Number(id));
		if (!session) {
			return Results.notFound();
		}
		return Results.ok(toPublic(session));
	}

	private async getRoster(id: string): Promise<Result<GetSessionRosterResponse>> {
		const roster = await this.sessionsServer.getRoster(Number(id));
		if (!roster) {
			return Results.notFound();
		}
		return Results.ok({ enrollments: roster.enrollments.map(toPublic), classMemberStudentIds: roster.classMemberStudentIds });
	}

	private async createSession(body: CreateSessionBody): Promise<Result<CreateSessionResponse>> {
		const { operatorId, title, startTime, capacityLimit } = body;
		try {
			const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
			if (!session) {
				return Results.notFound();
			}
			return Results.created(toPublic(session));
		} catch (error) {
			if (error instanceof PlainSessionNotAllowedError) {
				return Results.badRequest(error.message);
			}
			throw error;
		}
	}

	private async cancelSession(id: string): Promise<Result<never>> {
		const session = await this.sessionsServer.cancel(Number(id));
		if (!session) {
			return Results.notFound();
		}
		return Results.noContent();
	}

	private async rescheduleSession(id: string, body: RescheduleSessionBody): Promise<Result<GetSessionResponse>> {
		try {
			const rescheduled = await this.sessionsServer.reschedule(Number(id), body.startTime);
			if (!rescheduled) {
				return Results.notFound();
			}
			return Results.ok(toPublic(rescheduled));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}

	// Returns recorded attendance for a true one-off session; 404 if the session itself doesn't exist.
	private async getAttendance(id: string): Promise<Result<SessionAttendanceResponse>> {
		const sessionId = Number(id);
		const session = await this.sessionsServer.findById(sessionId);
		if (!session) {
			return Results.notFound();
		}
		const rows = await this.sessionAttendanceServer.findBySessionId(sessionId);
		return Results.ok(rows.map((row: SessionAttendance): SessionAttendanceResponseItem => ({ studentId: row.studentId, status: row.status })));
	}

	private async recordAttendance(id: string, body: SessionAttendanceBody): Promise<Result<SessionAttendanceResponse>> {
		try {
			const result = await this.sessionAttendanceServer.recordForSessionId(Number(id), null, body?.attendance);
			if (!result) {
				return Results.notFound();
			}
			return Results.ok(result.map((row: SessionAttendance): SessionAttendanceResponseItem => ({ studentId: row.studentId, status: row.status })));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
}
