import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { AttendanceCreditsServer } from '../../../servers/attendance-credits.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListSessionCreditsResponse } from './types/list-session-credits-response.type';
import { toPublic } from '../../../utils/to-public';

// UC3: Attendance Tracking & Automated Make-Up Credit State Machine
@injectable()
export class AttendanceCreditsController extends BaseController {
	public constructor(@inject(TYPES.AttendanceCreditsServer) private readonly attendanceCreditsServer: AttendanceCreditsServer) {
		super();

		/**
		 * @openapi
		 * /api/operator/attendance-credits/session/{sessionId}:
		 *   get:
		 *     summary: List enrollments/credits for a session
		 *     tags: [Operator - Attendance Credits]
		 *     parameters:
		 *       - in: path
		 *         name: sessionId
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
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/session/:sessionId', RouteHandlers.wrap(this.listCreditsBySession.bind(this)));

		// TODO: requires a cancellation-policy-window column (PRD: "e.g. >24 hours before session start") on operators or sessions -
		// no such column exists yet.
		this.internalRouter.put('/policy', RouteHandlers.notImplemented);

		// TODO: the daily token-expiration cron job (PRD UC3 edge case) has no scheduling infrastructure in this project yet (no
		// cron/job-runner dependency installed) - this route would trigger it manually/for testing once that exists.
		this.internalRouter.post('/expire-tokens', RouteHandlers.notImplemented);
	}

	private async listCreditsBySession(req: Request<{ sessionId: string }>, res: Response<ListSessionCreditsResponse>): Promise<void> {
		const enrollments = await this.attendanceCreditsServer.listBySession(Number(req.params.sessionId));
		if (!enrollments) {
			res.status(404).end();
			return;
		}
		res.json(enrollments.map(toPublic));
	}
}
