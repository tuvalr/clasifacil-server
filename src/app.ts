import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { inject, injectable } from 'inversify';
import { TYPES } from './container/types';
import { Config } from './config/env';
import { Logger } from './logger/logger';
import { RequestContext } from './controllers/shared/request-context';
import { RouteHandlers } from './controllers/shared/route-handlers';
import { swaggerSpec } from './docs/swagger-spec';
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
		// Swagger UI exposes route/schema structure — not something to
		// hand out in prod, so it's only mounted for dev/local.
		if (this.config.nodeEnv === 'dev' || this.config.nodeEnv === 'local') {
			this.internalExpress.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
		}

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
