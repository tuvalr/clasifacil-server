import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer } from '../../../servers/households.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListHouseholdsResponse } from './types/list-households-response.type';
import { GetHouseholdResponse } from './types/get-household-response.type';
import { ListHouseholdStudentsResponse } from './types/list-household-students-response.type';
import { toPublic } from '../../../utils/to-public';

// UC1: Household & Multi-Student Account Management
@injectable()
export class HouseholdsController extends BaseController {
	public constructor(@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer) {
		super();

		/**
		 * @openapi
		 * /api/operator/households:
		 *   get:
		 *     summary: List households
		 *     tags: [Operator - Households]
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Household' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/', RouteHandlers.wrap(this.listHouseholds.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}:
		 *   get:
		 *     summary: Get household by ID
		 *     tags: [Operator - Households]
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
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getHouseholdById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}/students:
		 *   get:
		 *     summary: List a household's students
		 *     tags: [Operator - Households]
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
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/students', RouteHandlers.wrap(this.listStudents.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}/archive:
		 *   post:
		 *     summary: Archive a household
		 *     tags: [Operator - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Archived }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/archive', RouteHandlers.wrap(this.archiveHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/operator/households/{id}/restore:
		 *   post:
		 *     summary: Restore an archived household
		 *     tags: [Operator - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Restored }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/restore', RouteHandlers.wrap(this.restoreHousehold.bind(this)));
		// TODO: requires a co-household-owner/secondary-adult table (PRD UC1: "grant
		// secondary view/booking access to a co-household-owner via email invite") —
		// no such table exists yet.
		this.internalRouter.post('/:id/invite-co-household-owner', RouteHandlers.notImplemented);
	}

	private async listHouseholds(_req: Request, res: Response<ListHouseholdsResponse>): Promise<void> {
		const households = await this.householdsServer.listAll();
		res.json(households.map(toPublic));
	}

	private async getHouseholdById(req: Request<{ id: string }>, res: Response<GetHouseholdResponse>): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}

	private async listStudents(req: Request<{ id: string }>, res: Response<ListHouseholdStudentsResponse>): Promise<void> {
		const students = await this.householdsServer.listStudents(Number(req.params.id));
		if (!students) {
			res.status(404).end();
			return;
		}
		res.json(students.map(toPublic));
	}

	private async archiveHousehold(req: Request<{ id: string }>, res: Response): Promise<void> {
		const household = await this.householdsServer.archive(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.status(204).end();
	}

	private async restoreHousehold(req: Request<{ id: string }>, res: Response): Promise<void> {
		const household = await this.householdsServer.restore(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.status(204).end();
	}
}
