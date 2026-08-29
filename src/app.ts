import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { inject, injectable } from 'inversify';
import { TYPES } from './container/types';
import { Config } from './config/env';
import { Logger } from './logger/logger';
import { RequestContext } from './controllers/shared/request-context';
import { RouteHandlers } from './controllers/shared/route-handlers';
import { AdminController } from './controllers/admin.controller';
import { OperatorController } from './controllers/operator.controller';
import { ParentController } from './controllers/parent.controller';

@injectable()
export class App {
	private readonly internalExpress: Express;

	public constructor(
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.Logger) private readonly logger: Logger,
		@inject(TYPES.AdminController) private readonly adminController: AdminController,
		@inject(TYPES.OperatorController) private readonly operatorController: OperatorController,
		@inject(TYPES.ParentController) private readonly parentController: ParentController,
	) {
		this.internalExpress = express();
		this.middleware();
		this.routes();
		this.errorHandling();
	}

	public get express(): Express {
		return this.internalExpress;
	}

	private middleware(): void {
		this.internalExpress.use(RequestContext.middleware);
		this.internalExpress.use(helmet());
		this.internalExpress.use(cors({ origin: this.config.corsOrigin }));
		this.internalExpress.use(express.json());
	}

	private routes(): void {
		this.internalExpress.use('/api/admin', this.adminController.router);
		this.internalExpress.use('/api/operator', this.operatorController.router);
		this.internalExpress.use('/api/parent', this.parentController.router);
	}

	// Must be mounted after every route —
	// Express only invokes 4-param (error-handling) middleware for errors forwarded by something registered before it.
	private errorHandling(): void {
		this.internalExpress.use(RouteHandlers.errorHandler(this.logger));
	}
}
