import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { AttendanceCreditsServer } from '../../../servers/attendance-credits.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { ListOwnCreditsResponse } from './types/list-own-credits-response.type';
import { CancelEnrollmentResponse } from './types/cancel-enrollment-response.type';
import { toPublic } from '../../../utils/to-public';

// UC3: Attendance Tracking & Automated Make-Up Credit State Machine
@injectable()
export class HouseholdAttendanceCreditsController extends BaseController {
	public constructor(@inject(TYPES.AttendanceCreditsServer) private readonly attendanceCreditsServer: AttendanceCreditsServer) {
		super();

		/**
		 * @openapi
		 * /api/household/attendance-credits/{enrollmentId}/cancel:
		 *   post:
		 *     summary: Cancel an enrollment
		 *     tags: [Household - Attendance Credits]
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
		this.internalRouter.post('/:enrollmentId/cancel', RouteHandlers.wrapResult(['enrollmentId'], this.cancelEnrollment.bind(this)));

		/**
		 * @openapi
		 * /api/household/attendance-credits/households/{householdId}/credits:
		 *   get:
		 *     summary: List own household's credits
		 *     tags: [Household - Attendance Credits]
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
		this.internalRouter.get('/households/:householdId/credits', RouteHandlers.wrapResult(['householdId'], this.listCredits.bind(this)));
	}

	private async listCredits(householdId: string, _body: unknown, _query: unknown): Promise<Result<ListOwnCreditsResponse>> {
		const credits = await this.attendanceCreditsServer.listCredits(Number(householdId));
		if (!credits) {
			return Results.notFound();
		}
		return Results.ok(credits.map(toPublic));
	}

	private async cancelEnrollment(enrollmentId: string, _body: unknown, _query: unknown): Promise<Result<CancelEnrollmentResponse>> {
		const updated = await this.attendanceCreditsServer.cancel(Number(enrollmentId));
		if (!updated) {
			return Results.notFound();
		}
		return Results.ok(toPublic(updated));
	}
}
