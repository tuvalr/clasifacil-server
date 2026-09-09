import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { OperatorsServer } from '../../servers/operators.server';
import { ValidationError } from '../../servers/types/validation-error';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';
import { ListOperatorsResponse } from './types/list-operators-response.type';
import { GetOperatorResponse } from './types/get-operator-response.type';
import { CreateOperatorBody } from './types/create-operator-body.type';
import { CreateOperatorResponse } from './types/create-operator-response.type';
import { CreateOperatorValidationErrorResponse } from './types/create-operator-validation-error-response.type';
import { PauseOperatorBody } from './types/pause-operator-body.type';

@injectable()
export class AdminController extends BaseController {
	public constructor(@inject(TYPES.OperatorsServer) private readonly operatorsServer: OperatorsServer) {
		super();
		this.internalRouter.use('/operators', this.operatorsRouter());
	}

	private operatorsRouter(): Router {
		const router = Router();

		/**
		 * @openapi
		 * /api/admin/operators:
		 *   get:
		 *     summary: List operators
		 *     tags: [Admin]
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Operator' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/', RouteHandlers.wrap(this.listOperators.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}:
		 *   get:
		 *     summary: Get operator by ID
		 *     tags: [Admin]
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
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.get('/:id', RouteHandlers.wrap(this.getOperatorById.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators:
		 *   post:
		 *     summary: Create an operator and its login user
		 *     description: >
		 *       The login identifier (auth_uid) is generated server-side, not
		 *       accepted from the client. name and email must each be unique;
		 *       phone is validated against countryCode (ISO 3166-1 alpha-2).
		 *     tags: [Admin]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [name, email, phone, countryCode]
		 *             properties:
		 *               name: { type: string }
		 *               email: { type: string }
		 *               phone: { type: string, description: 'National-format phone number, validated against countryCode' }
		 *               countryCode: { type: string, description: 'ISO 3166-1 alpha-2 country code, e.g. US' }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 operator: { $ref: '#/components/schemas/Operator' }
		 *                 user: { $ref: '#/components/schemas/User' }
		 *       400:
		 *         description: Validation failed
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 error: { type: string }
		 *                 details:
		 *                   type: array
		 *                   items:
		 *                     type: object
		 *                     properties:
		 *                       field: { type: string }
		 *                       message: { type: string }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/', RouteHandlers.wrap(this.createOperator.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}:
		 *   delete:
		 *     summary: Delete an operator and its login user
		 *     description: Soft-deletes the operator and its associated users row together, so it immediately loses login access.
		 *     tags: [Admin]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Deleted }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.delete('/:id', RouteHandlers.wrap(this.deleteOperator.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}/pause:
		 *   post:
		 *     summary: Pause an operator
		 *     description: >
		 *       Omit pausedUntil (or send null) for an unlimited pause. Resuming
		 *       is always explicit via /resume — a pausedUntil timestamp in the
		 *       past does not auto-reactivate the operator.
		 *     tags: [Admin]
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
		 *               pausedUntil: { type: string, format: date-time, nullable: true, description: 'Omit or null for an unlimited pause' }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/pause', RouteHandlers.wrap(this.pauseOperator.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}/resume:
		 *   post:
		 *     summary: Resume a paused operator
		 *     tags: [Admin]
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
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/:id/resume', RouteHandlers.wrap(this.resumeOperator.bind(this)));

		return router;
	}

	private async listOperators(_req: Request, res: Response<ListOperatorsResponse>): Promise<void> {
		const operators = await this.operatorsServer.listAll();
		res.json(operators);
	}

	private async getOperatorById(req: Request<{ id: string }>, res: Response<GetOperatorResponse>): Promise<void> {
		const operator = await this.operatorsServer.findById(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(operator);
	}

	private async createOperator(
		req: Request<unknown, CreateOperatorResponse | CreateOperatorValidationErrorResponse, CreateOperatorBody>,
		res: Response<CreateOperatorResponse | CreateOperatorValidationErrorResponse>,
	): Promise<void> {
		const { name, email, phone, countryCode } = req.body;
		try {
			const result = await this.operatorsServer.create({ name, email, phone, countryCode });
			res.status(201).json(result);
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async deleteOperator(req: Request<{ id: string }>, res: Response): Promise<void> {
		const operator = await this.operatorsServer.delete(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.status(204).end();
	}

	private async pauseOperator(req: Request<{ id: string }, GetOperatorResponse, PauseOperatorBody>, res: Response<GetOperatorResponse>): Promise<void> {
		const pausedUntil = req.body.pausedUntil ? new Date(req.body.pausedUntil) : null;
		const operator = await this.operatorsServer.pause(Number(req.params.id), pausedUntil);
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(operator);
	}

	private async resumeOperator(req: Request<{ id: string }>, res: Response<GetOperatorResponse>): Promise<void> {
		const operator = await this.operatorsServer.resume(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(operator);
	}
}
