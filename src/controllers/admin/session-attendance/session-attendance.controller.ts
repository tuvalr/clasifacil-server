import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { SessionAttendanceServer } from '../../../servers/session-attendance.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ArchiveAttendanceResponse } from './types/archive-attendance-response.type';

@injectable()
export class AdminSessionAttendanceController extends BaseController {
	public constructor(@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendanceServer: SessionAttendanceServer) {
		super();

		/**
		 * @openapi
		 * /api/admin/session-attendance/archive:
		 *   post:
		 *     summary: Archive attendance records older than 6 months
		 *     description: Moves every session_attendance row with updated_at older than 6 months into session_attendance_history and removes it from the live table.
		 *     tags: [Admin]
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 archivedCount: { type: integer }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/archive', RouteHandlers.wrap(this.archive.bind(this)));
	}

	private async archive(_req: Request, res: Response<ArchiveAttendanceResponse>): Promise<void> {
		const archivedCount = await this.sessionAttendanceServer.archive();
		res.json({ archivedCount });
	}
}
