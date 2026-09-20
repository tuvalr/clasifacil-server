import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer } from '../../../servers/households.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { GetOwnHouseholdResponse } from './types/get-own-household-response.type';
import { UpdateHouseholdBody } from './types/update-household-body.type';
import { UpdateHouseholdResponse } from './types/update-household-response.type';
import { ListOwnStudentsResponse } from './types/list-own-students-response.type';
import { CreateStudentBody } from './types/create-student-body.type';
import { CreateStudentResponse } from './types/create-student-response.type';
import { UpdateStudentBody } from './types/update-student-body.type';
import { UpdateStudentResponse } from './types/update-student-response.type';
import { toPublic } from '../../../utils/to-public';

// UC1: Household & Multi-Student Account Management
@injectable()
export class HouseholdHouseholdsController extends BaseController {
	public constructor(@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer) {
		super();

		/**
		 * @openapi
		 * /api/household/households/{id}:
		 *   get:
		 *     summary: Get own household
		 *     tags: [Household - Households]
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
		this.internalRouter.get('/:id', RouteHandlers.wrapOneParam('id', this.getHouseholdById.bind(this)));

		/**
		 * @openapi
		 * /api/household/households/{id}:
		 *   put:
		 *     summary: Update own household
		 *     tags: [Household - Households]
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
		 *               name: { type: string }
		 *               email: { type: string }
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
		this.internalRouter.put('/:id', RouteHandlers.wrapOneParamBody('id', this.updateHousehold.bind(this)));

		/**
		 * @openapi
		 * /api/household/households/{id}/students:
		 *   get:
		 *     summary: List own students
		 *     tags: [Household - Households]
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
		this.internalRouter.get('/:id/students', RouteHandlers.wrapOneParam('id', this.listStudents.bind(this)));

		/**
		 * @openapi
		 * /api/household/households/{id}/students:
		 *   post:
		 *     summary: Add a student to own household
		 *     tags: [Household - Households]
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
		 *             required: [fullName]
		 *             properties:
		 *               fullName: { type: string }
		 *               dateOfBirth: { type: string, format: date-time, nullable: true }
		 *               notes: { type: string, nullable: true }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Student' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Household not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/students', RouteHandlers.wrapOneParamBody('id', this.createStudent.bind(this)));

		/**
		 * @openapi
		 * /api/household/households/{id}/students/{studentId}:
		 *   put:
		 *     summary: Update own student
		 *     tags: [Household - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: studentId
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             properties:
		 *               fullName: { type: string }
		 *               notes: { type: string, nullable: true }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Student' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id/students/:studentId', RouteHandlers.wrapTwoParamsBody(['id', 'studentId'], this.updateStudent.bind(this)));

		// PRD UC1 edge case: "Archiving a Student Profile" - retain historical attendance/invoice logs, remove from active roster
		// selectors. This is exactly PostgresHandler's soft-delete, so it IS implemented.
		/**
		 * @openapi
		 * /api/household/households/{id}/students/{studentId}/archive:
		 *   post:
		 *     summary: Archive own student
		 *     tags: [Household - Households]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: studentId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Archived }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/students/:studentId/archive', RouteHandlers.wrapTwoParams(['id', 'studentId'], this.archiveStudent.bind(this)));

		// TODO: requires a co-household-owner/secondary-adult table (PRD: "grant secondary view/booking access to a co-household-owner or
		// caregiver via email invite") - no such table exists yet.
		this.internalRouter.get('/:id/co-household-owners', RouteHandlers.notImplemented);

		this.internalRouter.post('/:id/co-household-owners/invite', RouteHandlers.notImplemented);
	}

	private async getHouseholdById(id: string): Promise<Result<GetOwnHouseholdResponse>> {
		const household = await this.householdsServer.getById(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}

	private async updateHousehold(id: string, body: UpdateHouseholdBody): Promise<Result<UpdateHouseholdResponse>> {
		const { name, email } = body;
		const household = await this.householdsServer.update(Number(id), { name, email });
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}

	private async listStudents(id: string): Promise<Result<ListOwnStudentsResponse>> {
		const students = await this.householdsServer.listStudents(Number(id));
		if (!students) {
			return Results.notFound();
		}
		return Results.ok(students.map(toPublic));
	}

	private async createStudent(id: string, body: CreateStudentBody): Promise<Result<CreateStudentResponse>> {
		const { fullName, dateOfBirth, notes } = body;
		const student = await this.householdsServer.createStudent({
			householdId: Number(id),
			fullName,
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
			notes,
		});
		if (!student) {
			return Results.notFound();
		}
		return Results.created(toPublic(student));
	}

	private async updateStudent(_id: string, studentId: string, body: UpdateStudentBody): Promise<Result<UpdateStudentResponse>> {
		const { fullName, notes } = body;
		const student = await this.householdsServer.updateStudent(Number(studentId), { fullName, notes });
		if (!student) {
			return Results.notFound();
		}
		return Results.ok(toPublic(student));
	}

	private async archiveStudent(_id: string, studentId: string): Promise<Result<never>> {
		const student = await this.householdsServer.archiveStudent(Number(studentId));
		if (!student) {
			return Results.notFound();
		}
		return Results.noContent();
	}
}
