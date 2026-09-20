import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { ClassesServer } from '../../../servers/classes.server';
import { ClassHasActiveEnrollmentsError, AssignStudentResult } from '../../../servers/types/classes.server.types';
import { ValidationError, ValidationErrorDetail } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { BaseController } from '../../shared/base.controller';
import { ListClassesResponse } from './types/list-classes-response.type';
import { GetClassResponse } from './types/get-class-response.type';
import { ClassMutationResponse } from './types/class-mutation-response.type';
import { CreateClassBody } from './types/create-class-body.type';
import { UpdateClassBody } from './types/update-class-body.type';
import { AssignStudentsBody } from './types/assign-students-body.type';
import { AssignStudentsResponse, AssignStudentsResponseItem } from './types/assign-students-response.type';
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
		this.internalRouter.get('/', RouteHandlers.wrapNoParamsQuery(this.listClasses.bind(this)));

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
		this.internalRouter.get('/:id', RouteHandlers.wrapOneParam('id', this.getClassById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes:
		 *   post:
		 *     summary: Create a recurring class
		 *     description: >
		 *       Creates the class definition only - occurrence generation and makeup sessions are separate endpoints.
		 *       For assigned-type operators (padel instructors, personal trainers), studentId is required and
		 *       maxSize must be exactly 1 - the single student is assigned atomically at creation. For schedule-type
		 *       operators, studentId is forbidden; use assign-students instead.
		 *     tags: [Operator - Classes]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [operatorId, title, dayOfWeek, startTime, durationMinutes, maxSize]
		 *             properties:
		 *               operatorId: { type: integer }
		 *               title: { type: string }
		 *               dayOfWeek: { type: integer, minimum: 0, maximum: 6, description: "0 (Sunday) through 6 (Saturday), in the operator's timezone" }
		 *               startTime: { type: string, description: "HH:MM:SS, local wall-clock time in the operator's timezone (see Operator.timezone) - never UTC" }
		 *               durationMinutes: { type: integer }
		 *               minSize: { type: integer, nullable: true }
		 *               maxSize: { type: integer }
		 *               studentId: { type: integer, description: 'Required for assigned-type operators; forbidden otherwise' }
		 *               color: { type: string, nullable: true, description: 'Operator-chosen display color, unenforced format. Defaults to null.' }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
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
		this.internalRouter.post('/', RouteHandlers.wrapNoParamsBody(this.createClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   put:
		 *     summary: Update a class's recurring pattern
		 *     description: Never touches already-materialized sessions or virtual future occurrences (which always read the class's current fields live) - only affects the stored pattern (title, day/time, capacity) going forward.
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
		 *               title: { type: string }
		 *               dayOfWeek: { type: integer, minimum: 0, maximum: 6, description: "0 (Sunday) through 6 (Saturday), in the operator's timezone" }
		 *               startTime: { type: string, description: "HH:MM:SS, local wall-clock time in the operator's timezone (see Operator.timezone) - never UTC" }
		 *               durationMinutes: { type: integer }
		 *               minSize: { type: integer, nullable: true }
		 *               maxSize: { type: integer }
		 *               color: { type: string, nullable: true, description: 'Operator-chosen display color, unenforced format.' }
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
		this.internalRouter.put('/:id', RouteHandlers.wrapOneParamBody('id', this.updateClass.bind(this)));

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
		this.internalRouter.delete('/:id', RouteHandlers.wrapOneParam('id', this.deleteClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/stop:
		 *   post:
		 *     summary: Stop a class
		 *     description: >
		 *       Reversible via /unstop. Blocks new derived occurrences past the stop moment; existing materialized
		 *       sessions and all history are untouched and remain fully queryable.
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
		this.internalRouter.post('/:id/stop', RouteHandlers.wrapOneParam('id', this.stopClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/unstop:
		 *   post:
		 *     summary: Reverse a class's stop
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
		this.internalRouter.post('/:id/unstop', RouteHandlers.wrapOneParam('id', this.unstopClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/assign-students:
		 *   post:
		 *     summary: Bulk-assign students to a class's standing roster
		 *     description: >
		 *       Each studentId is evaluated independently - partial success is possible. Not available for
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
		 *         description: Per-studentId results (200 even if some items failed - check each item's success field)
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Class not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/assign-students', RouteHandlers.wrapOneParamBody('id', this.assignStudents.bind(this)));

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
		this.internalRouter.post('/:id/unassign-students', RouteHandlers.wrapOneParamBody('id', this.unassignStudents.bind(this)));
	}

	// Internal helper, not an exposed route. "Class not found" is the only ValidationError raised once a
	// method's other inputs are well-formed, so a details field of "classId" means 404; anything else is a
	// genuine 400.
	private isClassIdError(error: ValidationError): boolean {
		return error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId');
	}

	// Lists all classes belonging to the given operator.
	private async listClasses(query: { operatorId?: string }): Promise<Result<ListClassesResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('operatorId is required');
		}
		const classes = await this.classesServer.listByOperatorId(operatorId);
		if (!classes) {
			return Results.notFound();
		}
		return Results.ok(classes.map(toPublic));
	}

	// Fetches a single class by id.
	private async getClassById(id: string): Promise<Result<GetClassResponse>> {
		const foundClass = await this.classesServer.findById(Number(id));
		if (!foundClass) {
			return Results.notFound();
		}
		return Results.ok(toPublic(foundClass));
	}

	// Creates a new recurring class definition, including atomic student assignment for assigned-type operators.
	private async createClass(body: CreateClassBody): Promise<Result<ClassMutationResponse>> {
		try {
			const created = await this.classesServer.create(body);
			return Results.created(toPublic(created));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}

	// Updates a class's stored recurring pattern (title, day/time, capacity) - never touches existing sessions.
	private async updateClass(id: string, body: UpdateClassBody): Promise<Result<ClassMutationResponse>> {
		try {
			const updated = await this.classesServer.update(Number(id), body);
			if (!updated) {
				return Results.notFound();
			}
			return Results.ok(toPublic(updated));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}

	// Soft-deletes a class; rejected with 409 if it still has active student enrollments.
	private async deleteClass(id: string): Promise<Result<never>> {
		try {
			const deleted = await this.classesServer.delete(Number(id));
			if (!deleted) {
				return Results.notFound();
			}
			return Results.noContent();
		} catch (error) {
			if (error instanceof ClassHasActiveEnrollmentsError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}

	// Stops a class, blocking new derived occurrences past this point; reversible via unstop.
	private async stopClass(id: string): Promise<Result<ClassMutationResponse>> {
		const stopped = await this.classesServer.stop(Number(id));
		if (!stopped) {
			return Results.notFound();
		}
		return Results.ok(toPublic(stopped));
	}

	// Reverses a previous stop, resuming derived occurrences.
	private async unstopClass(id: string): Promise<Result<ClassMutationResponse>> {
		const unstopped = await this.classesServer.unstop(Number(id));
		if (!unstopped) {
			return Results.notFound();
		}
		return Results.ok(toPublic(unstopped));
	}

	// Bulk-assigns students to a class's standing roster; each studentId succeeds or fails independently.
	private async assignStudents(id: string, body: AssignStudentsBody): Promise<Result<AssignStudentsResponse>> {
		try {
			const results = await this.classesServer.assignStudents(Number(id), body.studentIds);
			return Results.ok(
				results.map((result: AssignStudentResult): AssignStudentsResponseItem => (result.success ? { studentId: result.studentId, success: true, enrollment: result.enrollment } : { studentId: result.studentId, success: false, error: result.error })),
			);
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}

	// Bulk-removes students from a class's standing roster.
	private async unassignStudents(id: string, body: AssignStudentsBody): Promise<Result<never>> {
		try {
			await this.classesServer.unassignStudents(Number(id), body.studentIds);
			return Results.noContent();
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
}
