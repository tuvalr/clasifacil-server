import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { WarningsServer } from '../../../servers/warnings.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { ListWarningsResponse } from './types/list-warnings-response.type';

@injectable()
export class WarningsController extends BaseController {
	public constructor(@inject(TYPES.WarningsServer) private readonly warningsServer: WarningsServer) {
		super();

		/**
		 * @openapi
		 * /api/operator/warnings:
		 *   get:
		 *     summary: List warnings for an operator
		 *     description: >
		 *       General-purpose feed of things needing the operator's attention, computed live (never persisted).
		 *       Currently reports classes with fewer active students than their minSize - never a block, only a
		 *       signal for the operator to act on.
		 *     tags: [Operator - Warnings]
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
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 warnings: { type: array, items: { $ref: '#/components/schemas/Warning' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Operator not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/', RouteHandlers.wrapNoParamsQuery(this.listWarnings.bind(this)));
	}

	private async listWarnings(query: { operatorId?: string }): Promise<Result<ListWarningsResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('Operator is required');
		}
		const warnings = await this.warningsServer.listByOperatorId(operatorId);
		if (!warnings) {
			return Results.notFound();
		}
		return Results.ok({ warnings });
	}
}
