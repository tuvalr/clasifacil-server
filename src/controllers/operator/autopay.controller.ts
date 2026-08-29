import { Router } from 'express';
import { injectable } from 'inversify';
import { RouteHandlers } from '../shared/route-handlers';

// UC6: Parent Autopay Opt-Out & Operator Notice Controls (operator side —
// configuring the notice-period policy).
// TODO: entirely unsupported by the current schema — no notice-period
// config column exists on operators or households (PRD: "0 days notice
// vs. 14 days notice before the next billing cycle", global or
// per-household).
@injectable()
export class OperatorAutopayController {
	private readonly internalRouter: Router;

	public constructor() {
		this.internalRouter = Router();
		this.internalRouter.put('/policy', RouteHandlers.notImplemented);
		this.internalRouter.put('/policy/:householdId', RouteHandlers.notImplemented);
	}

	public get router(): Router {
		return this.internalRouter;
	}
}
