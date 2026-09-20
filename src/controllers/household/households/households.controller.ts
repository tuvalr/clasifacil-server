import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer } from '../../../servers/households.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
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
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getHouseholdById.bind(this)));

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
		this.internalRouter.put('/:id', RouteHandlers.wrap(this.updateHousehold.bind(this)));

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
		this.internalRouter.get('/:id/students', RouteHandlers.wrap(this.listStudents.bind(this)));

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
		this.internalRouter.post('/:id/students', RouteHandlers.wrap(this.createStudent.bind(this)));

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
		this.internalRouter.put('/:id/students/:studentId', RouteHandlers.wrap(this.updateStudent.bind(this)));

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
		this.internalRouter.post('/:id/students/:studentId/archive', RouteHandlers.wrap(this.archiveStudent.bind(this)));

		// TODO: requires a co-household-owner/secondary-adult table (PRD: "grant secondary view/booking access to a co-household-owner or
		// caregiver via email invite") - no such table exists yet.
		this.internalRouter.get('/:id/co-household-owners', RouteHandlers.notImplemented);

		this.internalRouter.post('/:id/co-household-owners/invite', RouteHandlers.notImplemented);
	}

	private async getHouseholdById(req: Request<{ id: string }>, res: Response<GetOwnHouseholdResponse>): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}

	private async updateHousehold(req: Request<{ id: string }, UpdateHouseholdResponse, UpdateHouseholdBody>, res: Response<UpdateHouseholdResponse>): Promise<void> {
		const { name, email } = req.body;
		const household = await this.householdsServer.update(Number(req.params.id), { name, email });
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}

	private async listStudents(req: Request<{ id: string }>, res: Response<ListOwnStudentsResponse>): Promise<void> {
		const students = await this.householdsServer.listStudents(Number(req.params.id));
		if (!students) {
			res.status(404).end();
			return;
		}
		res.json(students.map(toPublic));
	}

	private async createStudent(req: Request<{ id: string }, CreateStudentResponse, CreateStudentBody>, res: Response<CreateStudentResponse>): Promise<void> {
		const { fullName, dateOfBirth, notes } = req.body;
		const student = await this.householdsServer.createStudent({
			householdId: Number(req.params.id),
			fullName,
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
			notes,
		});
		if (!student) {
			res.status(404).end();
			return;
		}
		res.status(201).json(toPublic(student));
	}

	private async updateStudent(req: Request<{ id: string; studentId: string }, UpdateStudentResponse, UpdateStudentBody>, res: Response<UpdateStudentResponse>): Promise<void> {
		const { fullName, notes } = req.body;
		const student = await this.householdsServer.updateStudent(Number(req.params.studentId), { fullName, notes });
		if (!student) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(student));
	}

	private async archiveStudent(req: Request<{ id: string; studentId: string }>, res: Response): Promise<void> {
		const student = await this.householdsServer.archiveStudent(Number(req.params.studentId));
		if (!student) {
			res.status(404).end();
			return;
		}
		res.status(204).end();
	}
}
