import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { SessionsServer } from '../../../servers/sessions.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListSessionsQuery } from './types/list-sessions-query.type';
import { ListSessionsResponse } from './types/list-sessions-response.type';
import { GetSessionResponse } from './types/get-session-response.type';
import { GetSessionRosterResponse } from './types/get-session-roster-response.type';
import { CreateSessionBody } from './types/create-session-body.type';
import { CreateSessionResponse } from './types/create-session-response.type';

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
		 *             schema: { type: array, items: { $ref: '#/components/schemas/EnrollmentAndCredit' } }
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
	}

	private async listSessions(req: Request<unknown, ListSessionsResponse, unknown, ListSessionsQuery>, res: Response<ListSessionsResponse>): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const sessions = await this.sessionsServer.findByOperatorId(operatorId);
		if (!sessions) {
			res.status(404).end();
			return;
		}
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
		if (!roster) {
			res.status(404).end();
			return;
		}
		res.json(roster);
	}

	private async createSession(req: Request<unknown, CreateSessionResponse, CreateSessionBody>, res: Response<CreateSessionResponse>): Promise<void> {
		const { operatorId, title, startTime, capacityLimit } = req.body;
		const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
		if (!session) {
			res.status(404).end();
			return;
		}
		res.status(201).json(session);
	}

	private async cancelSession(req: Request<{ id: string }>, res: Response): Promise<void> {
		const session = await this.sessionsServer.cancel(Number(req.params.id));
		if (!session) {
			res.status(404).end();
			return;
		}
		res.status(204).end();
	}
}
