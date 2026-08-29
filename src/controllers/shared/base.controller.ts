import { Router } from 'express';

// Every controller builds an express.Router() in its constructor and
// exposes it via a `router` getter so App can mount it. This class owns
// that lifecycle; subclasses register their own routes against
// `this.internalRouter` in their own constructor (after calling super()).
export abstract class BaseController {
	protected readonly internalRouter: Router;

	protected constructor() {
		this.internalRouter = Router();
	}

	public get router(): Router {
		return this.internalRouter;
	}
}
