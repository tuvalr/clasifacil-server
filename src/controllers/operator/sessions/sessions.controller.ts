import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { SessionsServer, PlainSessionNotAllowedError } from '../../../servers/sessions.server';
import { ValidationError } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListSessionsQuery } from './types/list-sessions-query.type';
import { ListSessionsResponse } from './types/list-sessions-response.type';
import { GetSessionResponse } from './types/get-session-response.type';
import { GetSessionRosterResponse } from './types/get-session-roster-response.type';
import { CreateSessionBody } from './types/create-session-body.type';
import { CreateSessionResponse } from './types/create-session-response.type';
import { RescheduleSessionBody } from './types/reschedule-session-body.type';
import { PlainSessionErrorResponse } from './types/plain-session-error-response.type';
import { SessionValidationErrorResponse } from './types/session-validation-error-response.type';
import { toPublic } from '../../../utils/to-public';

// UC2: Automated Session Booking & Capacity Hard Limits
@injectable()
export class SessionsController extends BaseController {
	public constructor(@inject(TYPES.SessionsServer) private readonly sessionsServer: SessionsServer) {
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
		this.internalRouter.get('/', RouteHandlers.wrap(this.listSessions.bind(this)));

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
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getSessionById.bind(this)));

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
		this.internalRouter.get('/:id/roster', RouteHandlers.wrap(this.getRoster.bind(this)));

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
		this.internalRouter.post('/', RouteHandlers.wrap(this.createSession.bind(this)));

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
		this.internalRouter.post('/:id/cancel', RouteHandlers.wrap(this.cancelSession.bind(this)));

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
		this.internalRouter.patch('/:id/reschedule', RouteHandlers.wrap(this.rescheduleSession.bind(this)));
	}

	private async listSessions(req: Request<unknown, ListSessionsResponse, unknown, ListSessionsQuery>, res: Response<ListSessionsResponse>): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		if (!req.query.operatorId || Number.isNaN(operatorId)) {
			res.status(400).end();
			return;
		}

		const sessions = await this.sessionsServer.findByOperatorId(operatorId);
		if (!sessions) {
			res.status(404).end();
			return;
		}
		res.json(sessions.map(toPublic));
	}

	private async getSessionById(req: Request<{ id: string }>, res: Response<GetSessionResponse>): Promise<void> {
		const session = await this.sessionsServer.findById(Number(req.params.id));
		if (!session) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(session));
	}

	private async getRoster(req: Request<{ id: string }>, res: Response<GetSessionRosterResponse>): Promise<void> {
		const roster = await this.sessionsServer.getRoster(Number(req.params.id));
		if (!roster) {
			res.status(404).end();
			return;
		}
		res.json({ enrollments: roster.enrollments.map(toPublic), classMemberStudentIds: roster.classMemberStudentIds });
	}

	private async createSession(
		req: Request<unknown, CreateSessionResponse | PlainSessionErrorResponse, CreateSessionBody>,
		res: Response<CreateSessionResponse | PlainSessionErrorResponse>,
	): Promise<void> {
		const { operatorId, title, startTime, capacityLimit } = req.body;
		try {
			const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
			if (!session) {
				res.status(404).end();
				return;
			}
			res.status(201).json(toPublic(session));
		} catch (error) {
			if (error instanceof PlainSessionNotAllowedError) {
				res.status(400).json({ error: error.message });
				return;
			}
			throw error;
		}
	}

	private async cancelSession(req: Request<{ id: string }>, res: Response): Promise<void> {
		const session = await this.sessionsServer.cancel(Number(req.params.id));
		if (!session) {
			res.status(404).end();
			return;
		}
		res.status(204).end();
	}

	private async rescheduleSession(
		req: Request<{ id: string }, GetSessionResponse | SessionValidationErrorResponse, RescheduleSessionBody>,
		res: Response<GetSessionResponse | SessionValidationErrorResponse>,
	): Promise<void> {
		try {
			const rescheduled = await this.sessionsServer.reschedule(Number(req.params.id), req.body.startTime);
			if (!rescheduled) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(rescheduled));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}
}
