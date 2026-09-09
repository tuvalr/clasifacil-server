import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { AttendanceCreditsServer } from '../../../servers/attendance-credits.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListOwnCreditsResponse } from './types/list-own-credits-response.type';
import { CancelEnrollmentResponse } from './types/cancel-enrollment-response.type';

// UC3: Attendance Tracking & Automated Make-Up Credit State Machine
@injectable()
export class ParentAttendanceCreditsController extends BaseController {
	public constructor(@inject(TYPES.AttendanceCreditsServer) private readonly attendanceCreditsServer: AttendanceCreditsServer) {
		super();

		/**
		 * @openapi
		 * /api/parent/attendance-credits/{enrollmentId}/cancel:
		 *   post:
		 *     summary: Cancel an enrollment
		 *     tags: [Parent - Attendance Credits]
		 *     parameters:
		 *       - in: path
		 *         name: enrollmentId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/EnrollmentAndCredit' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:enrollmentId/cancel', RouteHandlers.wrap(this.cancelEnrollment.bind(this)));

		/**
		 * @openapi
		 * /api/parent/attendance-credits/households/{householdId}/credits:
		 *   get:
		 *     summary: List own household's credits
		 *     tags: [Parent - Attendance Credits]
		 *     parameters:
		 *       - in: path
		 *         name: householdId
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
		 *       404: { description: Household not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/households/:householdId/credits', RouteHandlers.wrap(this.listCredits.bind(this)));
	}

	private async listCredits(req: Request<{ householdId: string }>, res: Response<ListOwnCreditsResponse>): Promise<void> {
		const credits = await this.attendanceCreditsServer.listCredits(Number(req.params.householdId));
		if (!credits) {
			res.status(404).end();
			return;
		}
		res.json(credits);
	}

	private async cancelEnrollment(req: Request<{ enrollmentId: string }>, res: Response<CancelEnrollmentResponse>): Promise<void> {
		const enrollmentId = Number(req.params.enrollmentId);
		const updated = await this.attendanceCreditsServer.cancel(enrollmentId);
		if (!updated) {
			res.status(404).end();
			return;
		}
		res.json(updated);
	}
}
