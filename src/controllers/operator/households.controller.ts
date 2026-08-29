import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { HouseholdRepository } from '../../repositories/household.repository';
import { StudentRepository } from '../../repositories/student.repository';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';

// UC1: Household & Multi-Child Account Management (operator side).
@injectable()
export class OperatorHouseholdsController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
	) {
		super();
		this.internalRouter.get('/', RouteHandlers.wrap(this.list.bind(this)));
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getById.bind(this)));
		this.internalRouter.get('/:id/students', RouteHandlers.wrap(this.listStudents.bind(this)));
		this.internalRouter.post('/:id/archive', RouteHandlers.wrap(this.archive.bind(this)));
		this.internalRouter.post('/:id/restore', RouteHandlers.wrap(this.restore.bind(this)));
		// TODO: requires a co-parent/secondary-adult table (PRD UC1: "grant
		// secondary view/booking access to a co-parent via email invite") —
		// no such table exists yet.
		this.internalRouter.post('/:id/invite-co-parent', RouteHandlers.notImplemented);
	}

	private async list(req: Request, res: Response): Promise<void> {
		const households = await this.households.findAll();
		res.json(households);
	}

	private async getById(req: Request, res: Response): Promise<void> {
		const household = await this.households.findById(Number(req.params.id));
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

	private async archive(req: Request, res: Response): Promise<void> {
		await this.households.archive(Number(req.params.id));
		res.status(204).end();
	}

	private async restore(req: Request, res: Response): Promise<void> {
		await this.households.restore(Number(req.params.id));
		res.status(204).end();
	}
}
