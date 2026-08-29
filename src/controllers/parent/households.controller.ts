import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { HouseholdRepository } from '../../repositories/household.repository';
import { StudentRepository } from '../../repositories/student.repository';
import { notImplemented } from '../shared/not-implemented';
import { asyncHandler } from '../shared/async-handler';

// UC1: Household & Multi-Child Account Management (parent side).
@injectable()
export class ParentHouseholdsController {
	private readonly internalRouter: Router;

	public constructor(
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
	) {
		this.internalRouter = Router();
		this.internalRouter.get('/:id', asyncHandler(this.getById.bind(this)));
		this.internalRouter.put('/:id', asyncHandler(this.update.bind(this)));
		this.internalRouter.get('/:id/students', asyncHandler(this.listStudents.bind(this)));
		this.internalRouter.post('/:id/students', asyncHandler(this.createStudent.bind(this)));
		this.internalRouter.put('/:id/students/:studentId', asyncHandler(this.updateStudent.bind(this)));
		// PRD UC1 edge case: "Archiving a Child Profile" — retain
		// historical attendance/invoice logs, remove from active roster
		// selectors. This is exactly PostgresHandler's soft-delete, so it
		// IS implemented.
		this.internalRouter.post('/:id/students/:studentId/archive', asyncHandler(this.archiveStudent.bind(this)));
		// TODO: requires a co-parent/secondary-adult table (PRD: "grant
		// secondary view/booking access to a co-parent or caregiver via
		// email invite") — no such table exists yet.
		this.internalRouter.get('/:id/co-parents', notImplemented);
		this.internalRouter.post('/:id/co-parents/invite', notImplemented);
	}

	public get router(): Router {
		return this.internalRouter;
	}

	private async getById(req: Request, res: Response): Promise<void> {
		const household = await this.households.findById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async update(req: Request, res: Response): Promise<void> {
		const { name, email } = req.body as { name?: string; email?: string };
		const household = await this.households.update(Number(req.params.id), { name, email });
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(household);
	}

	private async listStudents(req: Request, res: Response): Promise<void> {
		const students = await this.students.findByHouseholdId(Number(req.params.id));
		res.json(students);
	}

	private async createStudent(req: Request, res: Response): Promise<void> {
		const { fullName, dateOfBirth, notes } = req.body as { fullName: string; dateOfBirth: string | null; notes: string | null };
		const student = await this.students.create({
			householdId: Number(req.params.id),
			fullName,
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
			notes,
		});
		res.status(201).json(student);
	}

	private async updateStudent(req: Request, res: Response): Promise<void> {
		const { fullName, notes } = req.body as { fullName?: string; notes?: string | null };
		const student = await this.students.update(Number(req.params.studentId), { fullName, notes });
		if (!student) {
			res.status(404).end();
			return;
		}
		res.json(student);
	}

	private async archiveStudent(req: Request, res: Response): Promise<void> {
		await this.students.archive(Number(req.params.studentId));
		res.status(204).end();
	}
}
