import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { PostgresHandler, TransactionHandle } from '../../services/postgres-handler';
import { OperatorRepository } from '../../repositories/operator.repository';
import { UserRepository } from '../../repositories/user.repository';

@injectable()
export class AdminOperatorsController {
	private readonly internalRouter: Router;

	public constructor(
		@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.UserRepository) private readonly users: UserRepository,
	) {
		this.internalRouter = Router();
		this.internalRouter.get('/', this.list.bind(this));
		this.internalRouter.get('/:id', this.getById.bind(this));
		this.internalRouter.post('/', this.create.bind(this));
	}

	public get router(): Router {
		return this.internalRouter;
	}

	private async list(_req: Request, res: Response): Promise<void> {
		const operators = await this.operators.findAll();
		res.json(operators);
	}

	private async getById(req: Request, res: Response): Promise<void> {
		const operator = await this.operators.findById(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(operator);
	}

	// Creates the operators row and its login-capable users row (role: 'operator', associatedEntityId: the new operator's id) together —
	// if either insert fails, both roll back, so an operator can never be left without a way to log in.
	private async create(req: Request, res: Response): Promise<void> {
		const { name, email, authUid } = req.body as { name: string; email: string; authUid: string };

		// TODO: create Auth user with authUid and email, and ensure that the authUid is unique (i.e., not already in use by another user).
		// If the Auth user creation fails, we should not create the operator or user rows in the database.

		const result = await this.db.transaction(async (transaction: TransactionHandle) => {
			const operator = await this.operators.create({ name, email }, transaction);
			const user = await this.users.create({ authUid, email, role: 'operator', associatedEntityId: operator.id }, transaction);
			return { operator, user };
		});

		res.status(201).json(result);
	}
}
