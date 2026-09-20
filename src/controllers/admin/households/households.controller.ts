import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer, HouseholdHasActiveBookingError } from '../../../servers/households.server';
import { ValidationError } from '../../../servers/types/validation-error';
import { Student } from '../../../entities/student.entity';
import { EnrollmentAndCredit } from '../../../entities/enrollment-and-credit.entity';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListHouseholdsResponse } from './types/list-households-response.type';
import { GetHouseholdResponse } from './types/get-household-response.type';
import { GetHouseholdDetailsResponse } from './types/get-household-details-response.type';
import { CreateHouseholdBody } from './types/create-household-body.type';
import { CreateHouseholdResponse } from './types/create-household-response.type';
import { CreateHouseholdValidationErrorResponse } from './types/create-household-validation-error-response.type';
import { PauseHouseholdBody } from './types/pause-household-body.type';
import { toPublic } from '../../../utils/to-public';

@injectable()
export class AdminHouseholdsController extends BaseController {
	public constructor(@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer) {
		super();

		/**
		 * @openapi
		 * /api/admin/households:
		 *   get:
		 *     summary: List households
		 *     tags: [Admin]
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
		 * /api/admin/households/{id}:
		 *   get:
		 *     summary: Get household by ID, with its students and their enrollments
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
		 *             schema: { $ref: '#/components/schemas/HouseholdDetails' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getHouseholdById.bind(this)));

		/**
		 * @openapi
		 * /api/admin/households:
		 *   post:
		 *     summary: Create a household and its login user
		 *     description: >
		 *       The login identifier (auth_uid) is generated server-side, not
		 *       accepted from the client. name and email must each be unique.
		 *     tags: [Admin]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [name, email]
		 *             properties:
		 *               name: { type: string }
		 *               email: { type: string }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 household: { $ref: '#/components/schemas/Household' }
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
		this.internalRouter.post('/', RouteHandlers.wrap(this.createHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/admin/households/{id}:
		 *   delete:
		 *     summary: Delete a household and its login user
		 *     description: >
		 *       Soft-deletes the household and its associated users row together, so it immediately loses login
		 *       access. Refused if the household currently has an active (booked) enrollment in an operator's
		 *       session - cancel or complete that booking first.
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
		 *       409: { description: 'Household has an active booking with an operator' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.delete('/:id', RouteHandlers.wrap(this.deleteHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/admin/households/{id}/pause:
		 *   post:
		 *     summary: Pause a household
		 *     description: >
		 *       Omit pausedUntil (or send null) for an unlimited pause. Resuming
		 *       is always explicit via /resume - a pausedUntil timestamp in the
		 *       past does not auto-reactivate the household.
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
		 *             schema: { $ref: '#/components/schemas/Household' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/pause', RouteHandlers.wrap(this.pauseHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/admin/households/{id}/resume:
		 *   post:
		 *     summary: Resume a paused household
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
		 *             schema: { $ref: '#/components/schemas/Household' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/resume', RouteHandlers.wrap(this.resumeHousehold.bind(this)));
	}

	private async listHouseholds(_req: Request, res: Response<ListHouseholdsResponse>): Promise<void> {
		const households = await this.householdsServer.listAll();
		res.json(households.map(toPublic));
	}

	private async getHouseholdById(req: Request<{ id: string }>, res: Response<GetHouseholdDetailsResponse>): Promise<void> {
		const details = await this.householdsServer.getByIdWithDetails(Number(req.params.id));
		if (!details) {
			res.status(404).end();
			return;
		}
		res.json({
			...toPublic(details.household),
			students: details.students.map((student: Student & { enrollments: EnrollmentAndCredit[] }) => ({
				...toPublic(student),
				enrollments: student.enrollments.map(toPublic),
			})),
		});
	}

	private async createHousehold(
		req: Request<unknown, CreateHouseholdResponse | CreateHouseholdValidationErrorResponse, CreateHouseholdBody>,
		res: Response<CreateHouseholdResponse | CreateHouseholdValidationErrorResponse>,
	): Promise<void> {
		const { name, email } = req.body;
		try {
			const result = await this.householdsServer.create({ name, email });
			res.status(201).json({ household: toPublic(result.household), user: toPublic(result.user) });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async deleteHousehold(req: Request<{ id: string }>, res: Response): Promise<void> {
		try {
			const household = await this.householdsServer.delete(Number(req.params.id));
			if (!household) {
				res.status(404).end();
				return;
			}
			res.status(204).end();
		} catch (error) {
			if (error instanceof HouseholdHasActiveBookingError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}

	private async pauseHousehold(req: Request<{ id: string }, GetHouseholdResponse, PauseHouseholdBody>, res: Response<GetHouseholdResponse>): Promise<void> {
		const pausedUntil = req.body?.pausedUntil ? new Date(req.body.pausedUntil) : null;
		const household = await this.householdsServer.pause(Number(req.params.id), pausedUntil);
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}

	private async resumeHousehold(req: Request<{ id: string }>, res: Response<GetHouseholdResponse>): Promise<void> {
		const household = await this.householdsServer.resume(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}
}
