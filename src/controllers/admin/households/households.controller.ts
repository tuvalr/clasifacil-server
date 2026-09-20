import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer } from '../../../servers/households.server';
import { HouseholdHasActiveBookingError } from '../../../servers/types/households.server.types';
import { ValidationError } from '../../../servers/types/validation-error';
import { Student } from '../../../entities/student.entity';
import { EnrollmentAndCredit } from '../../../entities/enrollment-and-credit.entity';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { ListHouseholdsResponse } from './types/list-households-response.type';
import { GetHouseholdResponse } from './types/get-household-response.type';
import { GetHouseholdDetailsResponse } from './types/get-household-details-response.type';
import { CreateHouseholdBody } from './types/create-household-body.type';
import { CreateHouseholdResponse } from './types/create-household-response.type';
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
		this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listHouseholds.bind(this)));

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
		this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getHouseholdById.bind(this)));

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
		this.internalRouter.post('/', RouteHandlers.wrapResult([], this.createHousehold.bind(this)));

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
		this.internalRouter.delete('/:id', RouteHandlers.wrapResult(['id'], this.deleteHousehold.bind(this)));

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
		this.internalRouter.post('/:id/pause', RouteHandlers.wrapResult(['id'], this.pauseHousehold.bind(this)));

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
		this.internalRouter.post('/:id/resume', RouteHandlers.wrapResult(['id'], this.resumeHousehold.bind(this)));
	}

	private async listHouseholds(_body: unknown, _query: unknown): Promise<Result<ListHouseholdsResponse>> {
		const households = await this.householdsServer.listAll();
		return Results.ok(households.map(toPublic));
	}

	private async getHouseholdById(id: string, _body: unknown, _query: unknown): Promise<Result<GetHouseholdDetailsResponse>> {
		const details = await this.householdsServer.getByIdWithDetails(Number(id));
		if (!details) {
			return Results.notFound();
		}
		return Results.ok({
			...toPublic(details.household),
			students: details.students.map((student: Student & { enrollments: EnrollmentAndCredit[] }) => ({
				...toPublic(student),
				enrollments: student.enrollments.map(toPublic),
			})),
		});
	}

	private async createHousehold(body: CreateHouseholdBody, _query: unknown): Promise<Result<CreateHouseholdResponse>> {
		const { name, email } = body;
		try {
			const result = await this.householdsServer.create({ name, email });
			return Results.created({ household: toPublic(result.household), user: toPublic(result.user) });
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}

	private async deleteHousehold(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		try {
			const household = await this.householdsServer.delete(Number(id));
			if (!household) {
				return Results.notFound();
			}
			return Results.noContent();
		} catch (error) {
			if (error instanceof HouseholdHasActiveBookingError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}

	private async pauseHousehold(id: string, body: PauseHouseholdBody, _query: unknown): Promise<Result<GetHouseholdResponse>> {
		const pausedUntil = body?.pausedUntil ? new Date(body.pausedUntil) : null;
		const household = await this.householdsServer.pause(Number(id), pausedUntil);
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}

	private async resumeHousehold(id: string, _body: unknown, _query: unknown): Promise<Result<GetHouseholdResponse>> {
		const household = await this.householdsServer.resume(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
}
