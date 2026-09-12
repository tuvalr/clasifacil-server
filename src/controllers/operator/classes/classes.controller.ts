import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { ClassesServer, ClassHasActiveEnrollmentsError, AssignStudentResult } from '../../../servers/classes.server';
import { ValidationError, ValidationErrorDetail } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListClassesResponse } from './types/list-classes-response.type';
import { GetClassResponse } from './types/get-class-response.type';
import { CreateClassBody } from './types/create-class-body.type';
import { CreateClassResponse } from './types/create-class-response.type';
import { ClassValidationErrorResponse } from './types/class-validation-error-response.type';
import { CreateClassResult } from './types/create-class-result.type';
import { UpdateClassBody } from './types/update-class-body.type';
import { PauseClassBody } from './types/pause-class-body.type';
import { AssignStudentsBody } from './types/assign-students-body.type';
import { AssignStudentsResponse, AssignStudentsResponseItem } from './types/assign-students-response.type';
import { GenerateOccurrencesBody } from './types/generate-occurrences-body.type';
import { GenerateOccurrencesResponse } from './types/generate-occurrences-response.type';
import { RecupSessionBody } from './types/recup-session-body.type';
import { GetSessionResponse } from '../sessions/types/get-session-response.type';
import { toPublic } from '../../../utils/to-public';

@injectable()
export class ClassesController extends BaseController {
	public constructor(@inject(TYPES.ClassesServer) private readonly classesServer: ClassesServer) {
		super();

		/**
		 * @openapi
		 * /api/operator/classes:
		 *   get:
		 *     summary: List classes for an operator
		 *     tags: [Operator - Classes]
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
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Class' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Operator not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/', RouteHandlers.wrap(this.listClasses.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   get:
		 *     summary: Get class by ID
		 *     tags: [Operator - Classes]
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
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getClassById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes:
		 *   post:
		 *     summary: Create a recurring class
		 *     description: >
		 *       Accepts a single class object or an array for bulk creation (satisfies bulk class definitions in one call).
		 *       Array requests return one per-item success/error result instead of a single class object — partial success is possible.
		 *       This endpoint creates the class definition only — occurrence generation and recup sessions are separate
		 *       endpoints (see Task 4 of the implementation plan). For assigned-type operators (padel instructors,
		 *       personal trainers), studentId is required and maxSize must be exactly 1 — the single student is
		 *       assigned atomically at creation. For schedule-type operators, studentId is forbidden; use
		 *       assign-students instead.
		 *     tags: [Operator - Classes]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             oneOf:
		 *               - type: object
		 *                 required: [operatorId, title, dayOfWeek, startTime, durationMinutes, maxSize]
		 *                 properties:
		 *                   operatorId: { type: integer }
		 *                   title: { type: string }
		 *                   dayOfWeek: { type: integer, minimum: 0, maximum: 6 }
		 *                   startTime: { type: string, description: 'HH:MM:SS' }
		 *                   durationMinutes: { type: integer }
		 *                   minSize: { type: integer, nullable: true }
		 *                   maxSize: { type: integer }
		 *                   studentId: { type: integer, description: 'Required for assigned-type operators; forbidden otherwise' }
		 *               - type: array
		 *                 items:
		 *                   type: object
		 *                   required: [operatorId, title, dayOfWeek, startTime, durationMinutes, maxSize]
		 *                   properties:
		 *                     operatorId: { type: integer }
		 *                     title: { type: string }
		 *                     dayOfWeek: { type: integer, minimum: 0, maximum: 6 }
		 *                     startTime: { type: string, description: 'HH:MM:SS' }
		 *                     durationMinutes: { type: integer }
		 *                     minSize: { type: integer, nullable: true }
		 *                     maxSize: { type: integer }
		 *                     studentId: { type: integer, description: 'Required for assigned-type operators; forbidden otherwise' }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema:
		 *               oneOf:
		 *                 - { $ref: '#/components/schemas/Class' }
		 *                 - type: array
		 *                   items:
		 *                     type: object
		 *                     properties:
		 *                       success: { type: boolean }
		 *                       class: { $ref: '#/components/schemas/Class' }
		 *                       error: { type: string }
		 *                       details:
		 *                         type: array
		 *                         items:
		 *                           type: object
		 *                           properties:
		 *                             field: { type: string }
		 *                             message: { type: string }
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
		this.internalRouter.post('/', RouteHandlers.wrap(this.createClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   put:
		 *     summary: Update a class's recurring pattern
		 *     description: Never touches already-generated sessions — only affects future generate-occurrences calls.
		 *     tags: [Operator - Classes]
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
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id', RouteHandlers.wrap(this.updateClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   delete:
		 *     summary: Delete a class
		 *     description: Refused (409) while the class has any active student enrollments.
		 *     tags: [Operator - Classes]
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
		 *       409: { description: 'Class has active student enrollments' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.delete('/:id', RouteHandlers.wrap(this.deleteClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/pause:
		 *   post:
		 *     summary: Pause a class
		 *     description: Omit pausedUntil (or send null) for an unlimited pause. Blocks new generation/assignment; existing generated sessions are untouched.
		 *     tags: [Operator - Classes]
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
		 *               pausedUntil: { type: string, format: date-time, nullable: true }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/pause', RouteHandlers.wrap(this.pauseClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/resume:
		 *   post:
		 *     summary: Resume a paused class
		 *     tags: [Operator - Classes]
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
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/resume', RouteHandlers.wrap(this.resumeClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/assign-students:
		 *   post:
		 *     summary: Bulk-assign students to a class's standing roster
		 *     description: >
		 *       Each studentId is evaluated independently — partial success is possible. Not available for
		 *       assigned-type classes (their single student is set at creation).
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
		 *             required: [studentIds]
		 *             properties:
		 *               studentIds: { type: array, items: { type: integer } }
		 *     responses:
		 *       200:
		 *         description: Per-studentId results (200 even if some items failed — check each item's success field)
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Class not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/assign-students', RouteHandlers.wrap(this.assignStudents.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/unassign-students:
		 *   post:
		 *     summary: Bulk-unassign students from a class's standing roster
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
		 *             required: [studentIds]
		 *             properties:
		 *               studentIds: { type: array, items: { type: integer } }
		 *     responses:
		 *       204: { description: Unassigned }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/unassign-students', RouteHandlers.wrap(this.unassignStudents.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/generate-occurrences:
		 *   post:
		 *     summary: Generate concrete session occurrences from a class's recurring pattern
		 *     description: Exactly one of `through` or `count` is required. Capped at 104 occurrences per call.
		 *     tags: [Operator - Classes]
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
		 *               through: { type: string, format: date }
		 *               count: { type: integer }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Session' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/generate-occurrences', RouteHandlers.wrap(this.generateOccurrences.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/recup-session:
		 *   post:
		 *     summary: Create a make-up session tied to this class
		 *     description: Any student id is accepted — not limited to active class members.
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
		 *             required: [startTime, studentIds]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *               studentIds: { type: array, items: { type: integer } }
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
		this.internalRouter.post('/:id/recup-session', RouteHandlers.wrap(this.createRecupSession.bind(this)));
	}

	private async listClasses(req: Request<unknown, ListClassesResponse, unknown, { operatorId?: string }>, res: Response<ListClassesResponse>): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		if (!req.query.operatorId || Number.isNaN(operatorId)) {
			res.status(400).end();
			return;
		}
		const classes = await this.classesServer.listByOperatorId(operatorId);
		if (!classes) {
			res.status(404).end();
			return;
		}
		res.json(classes.map(toPublic));
	}

	private async getClassById(req: Request<{ id: string }>, res: Response<GetClassResponse>): Promise<void> {
		const foundClass = await this.classesServer.findById(Number(req.params.id));
		if (!foundClass) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(foundClass));
	}

	private async createClass(
		req: Request<unknown, CreateClassResponse | ClassValidationErrorResponse | CreateClassResult[], CreateClassBody | CreateClassBody[]>,
		res: Response<CreateClassResponse | ClassValidationErrorResponse | CreateClassResult[]>,
	): Promise<void> {
		if (Array.isArray(req.body)) {
			const results: CreateClassResult[] = [];
			for (const item of req.body) {
				results.push(await this.createOneClass(item));
			}
			res.status(201).json(results);
			return;
		}

		const { operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, studentId } = req.body;
		try {
			const created = await this.classesServer.create({ operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, studentId });
			res.status(201).json(toPublic(created));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async createOneClass(body: CreateClassBody): Promise<CreateClassResult> {
		try {
			const created = await this.classesServer.create(body);
			return { success: true, class: toPublic(created) };
		} catch (error) {
			if (error instanceof ValidationError) {
				return { success: false, error: 'Validation failed', details: error.details };
			}
			throw error;
		}
	}

	private async updateClass(
		req: Request<{ id: string }, GetClassResponse | ClassValidationErrorResponse, UpdateClassBody>,
		res: Response<GetClassResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const updated = await this.classesServer.update(Number(req.params.id), req.body);
			if (!updated) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(updated));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async deleteClass(req: Request<{ id: string }>, res: Response): Promise<void> {
		try {
			const deleted = await this.classesServer.delete(Number(req.params.id));
			if (!deleted) {
				res.status(404).end();
				return;
			}
			res.status(204).end();
		} catch (error) {
			if (error instanceof ClassHasActiveEnrollmentsError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}

	private async pauseClass(req: Request<{ id: string }, GetClassResponse, PauseClassBody>, res: Response<GetClassResponse>): Promise<void> {
		const pausedUntil = req.body?.pausedUntil ? new Date(req.body.pausedUntil) : null;
		const paused = await this.classesServer.pause(Number(req.params.id), pausedUntil);
		if (!paused) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(paused));
	}

	private async resumeClass(req: Request<{ id: string }>, res: Response<GetClassResponse>): Promise<void> {
		const resumed = await this.classesServer.resume(Number(req.params.id));
		if (!resumed) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(resumed));
	}

	private async assignStudents(
		req: Request<{ id: string }, AssignStudentsResponse | ClassValidationErrorResponse, AssignStudentsBody>,
		res: Response<AssignStudentsResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const results = await this.classesServer.assignStudents(Number(req.params.id), req.body.studentIds);
			res.json(
				results.map((result: AssignStudentResult): AssignStudentsResponseItem =>
					result.success ? { studentId: result.studentId, success: true, enrollment: result.enrollment } : { studentId: result.studentId, success: false, error: result.error },
				),
			);
		} catch (error) {
			if (error instanceof ValidationError) {
				// "Class not found" is the only ValidationError raised once studentIds itself is well-formed (checked
				// first in ClassesServer.assignStudents), so a details field of "classId" means 404; anything else
				// (e.g. "studentIds" for a malformed body) is a genuine 400.
				if (error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId')) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async unassignStudents(req: Request<{ id: string }, ClassValidationErrorResponse, AssignStudentsBody>, res: Response<ClassValidationErrorResponse>): Promise<void> {
		try {
			await this.classesServer.unassignStudents(Number(req.params.id), req.body.studentIds);
			res.status(204).end();
		} catch (error) {
			if (error instanceof ValidationError) {
				// "Class not found" is indicated by a details field of "classId" (404); anything else
				// (e.g. "studentIds" for a malformed body, or "operatorType" for wrong operator type) is a genuine 400.
				if (error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId')) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async generateOccurrences(
		req: Request<{ id: string }, GenerateOccurrencesResponse | ClassValidationErrorResponse, GenerateOccurrencesBody>,
		res: Response<GenerateOccurrencesResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const sessions = await this.classesServer.generateOccurrences(Number(req.params.id), { through: req.body.through, count: req.body.count });
			res.status(201).json(sessions.map(toPublic));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId')) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async createRecupSession(
		req: Request<{ id: string }, GetSessionResponse | ClassValidationErrorResponse, RecupSessionBody>,
		res: Response<GetSessionResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const session = await this.classesServer.createRecupSession(Number(req.params.id), req.body.startTime, req.body.studentIds);
			res.status(201).json(toPublic(session));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId')) {
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
