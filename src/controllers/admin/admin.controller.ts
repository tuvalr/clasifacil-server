import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { OperatorsServer, ValidationError } from '../../servers/operators.server';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';
import { ListOperatorsResponse } from './types/list-operators-response.type';
import { GetOperatorResponse } from './types/get-operator-response.type';
import { CreateOperatorBody } from './types/create-operator-body.type';
import { CreateOperatorResponse } from './types/create-operator-response.type';
import { CreateOperatorValidationErrorResponse } from './types/create-operator-validation-error-response.type';

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
}
