import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { OperatorsServer } from '../servers/operators.server';
import { RouteHandlers } from './shared/route-handlers';
import { BaseController } from './shared/base.controller';

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
		 *     tags: [Admin]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [name, email, authUid]
		 *             properties:
		 *               name: { type: string }
		 *               email: { type: string }
		 *               authUid: { type: string }
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
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		router.post('/', RouteHandlers.wrap(this.createOperator.bind(this)));

		return router;
	}

	private async listOperators(_req: Request, res: Response): Promise<void> {
		const operators = await this.operatorsServer.listAll();
		res.json(operators);
	}

	private async getOperatorById(req: Request, res: Response): Promise<void> {
		const operator = await this.operatorsServer.findById(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(operator);
	}

	private async createOperator(req: Request, res: Response): Promise<void> {
		const { name, email, authUid } = req.body as { name: string; email: string; authUid: string };
		const result = await this.operatorsServer.create({ name, email, authUid });
		res.status(201).json(result);
	}
}
