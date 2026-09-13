import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { ClassOccurrencesServer, Occurrence } from '../../../servers/class-occurrences.server';
import { SessionAttendanceServer } from '../../../servers/session-attendance.server';
import { ValidationError, ValidationErrorDetail } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListOccurrencesQuery } from './types/list-occurrences-query.type';
import { ListOccurrencesResponse, OccurrenceResponseItem } from './types/occurrence.type';
import { RescheduleOccurrenceBody } from './types/reschedule-occurrence-body.type';
import { MakeupSessionBody } from './types/makeup-session-body.type';
import { ClassValidationErrorResponse } from './types/class-validation-error-response.type';
import { GetSessionResponse } from '../sessions/types/get-session-response.type';
import { SessionAttendanceBody } from '../sessions/types/session-attendance-body.type';
import { SessionAttendanceResponse, SessionAttendanceResponseItem } from '../sessions/types/session-attendance-response.type';
import { SessionAttendance } from '../../../entities/session-attendance.entity';
import { toPublic } from '../../../utils/to-public';

function toOccurrenceResponseItem(occurrence: Occurrence): OccurrenceResponseItem {
	if (occurrence.isVirtual) {
		return { isVirtual: true, classId: occurrence.classId, startTime: occurrence.startTime.toISOString(), title: null };
	}
	return {
		isVirtual: false,
		sessionId: occurrence.session.id,
		startTime: occurrence.session.startTime.toISOString(),
		isMakeupSession: occurrence.session.isMakeupSession,
		title: occurrence.session.title,
	};
}

@injectable()
export class ClassOccurrencesController extends BaseController {
	public constructor(
		@inject(TYPES.ClassOccurrencesServer) private readonly classOccurrencesServer: ClassOccurrencesServer,
		@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendanceServer: SessionAttendanceServer,
	) {
		super();

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/future:
		 *   get:
		 *     summary: List a class's future occurrences (virtual and materialized) in a date range
		 *     description: from must be today or later. Range capped at 90 full calendar days.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: query
		 *         name: from
		 *         required: true
		 *         schema: { type: string, format: date }
		 *       - in: query
		 *         name: to
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 occurrences: { type: array, items: { $ref: '#/components/schemas/Occurrence' } }
		 *                 classMemberStudentIds: { type: array, items: { type: integer } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/occurrences/future', RouteHandlers.wrap(this.listFuture.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/past:
		 *   get:
		 *     summary: List a class's past occurrences (materialized and not-recorded) in a date range
		 *     description: to must be today or earlier. Range capped at 90 full calendar days.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: query
		 *         name: from
		 *         required: true
		 *         schema: { type: string, format: date }
		 *       - in: query
		 *         name: to
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 occurrences: { type: array, items: { $ref: '#/components/schemas/Occurrence' } }
		 *                 classMemberStudentIds: { type: array, items: { type: integer } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/occurrences/past', RouteHandlers.wrap(this.listPast.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/{date}/reschedule:
		 *   patch:
		 *     summary: Reschedule one occurrence, materializing it if needed
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: date
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [startTime]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.patch('/:id/occurrences/:date/reschedule', RouteHandlers.wrap(this.rescheduleOccurrence.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/{date}/cancel:
		 *   post:
		 *     summary: Cancel one occurrence, materializing it first if needed
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: date
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     responses:
		 *       204: { description: Cancelled }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/occurrences/:date/cancel', RouteHandlers.wrap(this.cancelOccurrence.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/{date}/attendance:
		 *   put:
		 *     summary: Record or correct attendance for one occurrence, materializing it if needed
		 *     description: >
		 *       Accepts any studentId, not just current class members — this is how a trial student's attendance
		 *       can be recorded without a standing class_enrollments row.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: date
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [attendance]
		 *             properties:
		 *               attendance:
		 *                 type: array
		 *                 items: { $ref: '#/components/schemas/SessionAttendanceEntry' }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: array
		 *               items: { $ref: '#/components/schemas/SessionAttendanceEntry' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id/occurrences/:date/attendance', RouteHandlers.wrap(this.recordOccurrenceAttendance.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/makeup-session:
		 *   post:
		 *     summary: Create a make-up session tied to this class
		 *     description: Roster is auto-filled from the class's current standing class_enrollments members.
		 *     tags: [Operator - Classes]
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
		 *             required: [startTime]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/makeup-session', RouteHandlers.wrap(this.createMakeupSession.bind(this)));
	}

	private isClassIdError(error: ValidationError): boolean {
		return error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId');
	}

	private async listFuture(
		req: Request<{ id: string }, ListOccurrencesResponse | ClassValidationErrorResponse, unknown, ListOccurrencesQuery>,
		res: Response<ListOccurrencesResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const result = await this.classOccurrencesServer.listFuture(Number(req.params.id), req.query.from, req.query.to);
			if (!result) {
				res.status(404).end();
				return;
			}
			res.json({ occurrences: result.occurrences.map(toOccurrenceResponseItem), classMemberStudentIds: result.classMemberStudentIds });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async listPast(
		req: Request<{ id: string }, ListOccurrencesResponse | ClassValidationErrorResponse, unknown, ListOccurrencesQuery>,
		res: Response<ListOccurrencesResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const result = await this.classOccurrencesServer.listPast(Number(req.params.id), req.query.from, req.query.to);
			if (!result) {
				res.status(404).end();
				return;
			}
			res.json({ occurrences: result.occurrences.map(toOccurrenceResponseItem), classMemberStudentIds: result.classMemberStudentIds });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async rescheduleOccurrence(
		req: Request<{ id: string; date: string }, GetSessionResponse | ClassValidationErrorResponse, RescheduleOccurrenceBody>,
		res: Response<GetSessionResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const rescheduled = await this.classOccurrencesServer.rescheduleOccurrence(Number(req.params.id), req.params.date, req.body?.startTime);
			if (!rescheduled) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(rescheduled));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async cancelOccurrence(req: Request<{ id: string; date: string }>, res: Response): Promise<void> {
		try {
			const cancelled = await this.classOccurrencesServer.cancelOccurrence(Number(req.params.id), req.params.date);
			if (!cancelled) {
				res.status(404).end();
				return;
			}
			res.status(204).end();
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async recordOccurrenceAttendance(
		req: Request<{ id: string; date: string }, SessionAttendanceResponse | ClassValidationErrorResponse, SessionAttendanceBody>,
		res: Response<SessionAttendanceResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const classId = Number(req.params.id);
			const session = await this.classOccurrencesServer.materializeOccurrence(classId, new Date(`${req.params.date}T00:00:00.000Z`));
			// A cancelled date reports as not-found, same reasoning as ClassOccurrencesServer.rescheduleOccurrence:
			// recording attendance against an already-cancelled occurrence would silently succeed on a row that's
			// invisible to every listing (queryActive excludes it), rather than the caller's intent (marking
			// attendance for a real, upcoming/past occurrence) ever taking visible effect.
			if (session.isDeleted) {
				res.status(404).end();
				return;
			}
			const result = await this.sessionAttendanceServer.recordForSessionId(session.id, classId, req.body?.attendance);
			if (!result) {
				res.status(404).end();
				return;
			}
			res.json(result.map((row: SessionAttendance): SessionAttendanceResponseItem => ({ studentId: row.studentId, status: row.status })));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async createMakeupSession(
		req: Request<{ id: string }, GetSessionResponse | ClassValidationErrorResponse, MakeupSessionBody>,
		res: Response<GetSessionResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const session = await this.classOccurrencesServer.createMakeupSession(Number(req.params.id), req.body?.startTime);
			res.status(201).json(toPublic(session));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}
}
