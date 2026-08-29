import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { OperatorsServer } from '../servers/operators.server';
import { RouteHandlers } from './shared/route-handlers';
import { BaseController } from './shared/base.controller';

@injectable()
export class AdminController extends BaseController {
	public constructor(@inject(TYPES.OperatorsServer) private readonly operatorsServer: OperatorsServer) {
		super();
		this.internalRouter.use('/operators', this.operatorsRouter());
	}

	private operatorsRouter(): Router {
		const router = Router();
		router.get('/', RouteHandlers.wrap(this.listOperators.bind(this)));
		router.get('/:id', RouteHandlers.wrap(this.getOperatorById.bind(this)));
		router.post('/', RouteHandlers.wrap(this.createOperator.bind(this)));
		return router;
	}

	private async listOperators(_req: Request, res: Response): Promise<void> {
		const operators = await this.operatorsServer.listAll();
		res.json(operators);
	}

	private async getOperatorById(req: Request, res: Response): Promise<void> {
		const operator = await this.operatorsServer.findById(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(operator);
	}

	private async createOperator(req: Request, res: Response): Promise<void> {
		const { name, email, authUid } = req.body as { name: string; email: string; authUid: string };
		const result = await this.operatorsServer.create({ name, email, authUid });
		res.status(201).json(result);
	}
}
