import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { OperatorsServer } from '../../../servers/operators.server';
import { OperatorHasActiveClassesError, OperatorTimezoneLockedError } from '../../../servers/types/operators.server.types';
import { ValidationError } from '../../../servers/types/validation-error';
import { ClassRepository } from '../../../repositories/class.repository';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { ListOperatorsResponse } from './types/list-operators-response.type';
import { GetOperatorResponse } from './types/get-operator-response.type';
import { CreateOperatorBody } from './types/create-operator-body.type';
import { CreateOperatorResponse } from './types/create-operator-response.type';
import { ChangeOperatorTypeBody } from './types/change-operator-type-body.type';
import { PauseOperatorBody } from './types/pause-operator-body.type';
import { UpdateOperatorBody } from './types/update-operator-body.type';
import { toPublic } from '../../../utils/to-public';

@injectable()
export class AdminOperatorsController extends BaseController {
	public constructor(
		@inject(TYPES.OperatorsServer) private readonly operatorsServer: OperatorsServer,
		@inject(TYPES.ClassRepository) private readonly classRepository: ClassRepository,
	) {
		super();

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
		this.internalRouter.get('/', RouteHandlers.wrapNoParams(this.listOperators.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators:
		 *   post:
		 *     summary: Create an operator and its login user
		 *     description: >
		 *       The login identifier (auth_uid) is generated server-side, not
		 *       accepted from the client. name and email must each be unique;
		 *       phone is validated against countryCode (ISO 3166-1 alpha-2);
		 *       timezone must be a valid IANA timezone name.
		 *     tags: [Admin]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [name, email, phone, countryCode, type, timezone]
		 *             properties:
		 *               name: { type: string }
		 *               email: { type: string }
		 *               phone: { type: string, description: 'National-format phone number, validated against countryCode' }
		 *               countryCode: { type: string, description: 'ISO 3166-1 alpha-2 country code, e.g. US' }
		 *               type: { type: string, enum: [schedule, assigned] }
		 *               timezone: { type: string, description: 'IANA timezone name, e.g. America/New_York' }
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
		this.internalRouter.post('/', RouteHandlers.wrapNoParamsBody(this.createOperator.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}:
		 *   put:
		 *     summary: Update an operator
		 *     description: >
		 *       All fields optional - only provided fields are changed. name, email, and phone must each stay unique
		 *       across operators (and, for email, across all login accounts); phone is also validated against
		 *       countryCode when both are provided.
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
		 *               name: { type: string }
		 *               email: { type: string }
		 *               phone: { type: string, description: 'National-format phone number, validated against countryCode' }
		 *               countryCode: { type: string, description: 'ISO 3166-1 alpha-2 country code, e.g. US' }
		 *               timezone: { type: string, description: 'IANA timezone name, e.g. America/New_York' }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Operator' }
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
		 *       409: { description: 'timezone cannot be changed once the operator has any active (non-deleted) class' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id', RouteHandlers.wrapOneParamBody('id', this.updateOperator.bind(this)));

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
		this.internalRouter.delete('/:id', RouteHandlers.wrapOneParam('id', this.deleteOperator.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}/pause:
		 *   post:
		 *     summary: Pause an operator
		 *     description: >
		 *       Omit pausedUntil (or send null) for an unlimited pause. Resuming
		 *       is always explicit via /resume - a pausedUntil timestamp in the
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
		this.internalRouter.post('/:id/pause', RouteHandlers.wrapOneParamBody('id', this.pauseOperator.bind(this)));

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
		this.internalRouter.post('/:id/resume', RouteHandlers.wrapOneParam('id', this.resumeOperator.bind(this)));

		/**
		 * @openapi
		 * /api/admin/operators/{id}/change-type:
		 *   post:
		 *     summary: Change an operator's scheduling type
		 *     description: >
		 *       Refused (409) while the operator has any active (non-deleted) classes, regardless of pause status -
		 *       clear all classes first.
		 *     tags: [Admin]
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
		 *             required: [type]
		 *             properties:
		 *               type: { type: string, enum: [schedule, assigned] }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       409: { description: 'Operator has active classes' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/change-type', RouteHandlers.wrapOneParamBody('id', this.changeOperatorType.bind(this)));
	}

	private async listOperators(): Promise<Result<ListOperatorsResponse>> {
		const operators = await this.operatorsServer.listAll();
		return Results.ok(operators.map(toPublic));
	}

	private async createOperator(body: CreateOperatorBody): Promise<Result<CreateOperatorResponse>> {
		const { name, email, phone, countryCode, type, timezone } = body;
		try {
			const result = await this.operatorsServer.create({ name, email, phone, countryCode, type, timezone });
			return Results.created({ operator: toPublic(result.operator), user: toPublic(result.user) });
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}

	private async updateOperator(id: string, body: UpdateOperatorBody): Promise<Result<GetOperatorResponse>> {
		const { name, email, phone, countryCode, timezone } = body;
		try {
			const operator = await this.operatorsServer.update(Number(id), { name, email, phone, countryCode, timezone }, (operatorId: number) => this.classRepository.existsActiveForOperator(operatorId));
			if (!operator) {
				return Results.notFound();
			}
			return Results.ok(toPublic(operator));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			if (error instanceof OperatorTimezoneLockedError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}

	private async deleteOperator(id: string): Promise<Result<never>> {
		const operator = await this.operatorsServer.delete(Number(id));
		if (!operator) {
			return Results.notFound();
		}
		return Results.noContent();
	}

	private async pauseOperator(id: string, body: PauseOperatorBody): Promise<Result<GetOperatorResponse>> {
		const pausedUntil = body?.pausedUntil ? new Date(body.pausedUntil) : null;
		const operator = await this.operatorsServer.pause(Number(id), pausedUntil);
		if (!operator) {
			return Results.notFound();
		}
		return Results.ok(toPublic(operator));
	}

	private async resumeOperator(id: string): Promise<Result<GetOperatorResponse>> {
		const operator = await this.operatorsServer.resume(Number(id));
		if (!operator) {
			return Results.notFound();
		}
		return Results.ok(toPublic(operator));
	}

	private async changeOperatorType(id: string, body: ChangeOperatorTypeBody): Promise<Result<GetOperatorResponse>> {
		try {
			const operator = await this.operatorsServer.changeType(Number(id), body.type, (operatorId: number) => this.classRepository.existsActiveForOperator(operatorId));
			if (!operator) {
				return Results.notFound();
			}
			return Results.ok(toPublic(operator));
		} catch (error) {
			if (error instanceof OperatorHasActiveClassesError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}
}
