import path from 'path';
import express, { Express, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { inject, injectable } from 'inversify';
import { TYPES } from './container/types';
import { Config } from './config/env';
import { Logger } from './logger/logger';
import { RequestContext } from './controllers/shared/request-context';
import { RequestLogger } from './controllers/shared/request-logger';
import { RouteHandlers } from './controllers/shared/route-handlers';
import { swaggerSpec } from './docs/swagger-spec';
import { AdminController } from './controllers/admin/admin.controller';
import { OperatorController } from './controllers/operator/operator.controller';
import { HouseholdController } from './controllers/household/household.controller';

@injectable()
export class App {
	private readonly internalExpress: Express;

	public constructor(
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.Logger) private readonly logger: Logger,
		@inject(TYPES.AdminController) private readonly adminController: AdminController,
		@inject(TYPES.OperatorController) private readonly operatorController: OperatorController,
		@inject(TYPES.HouseholdController) private readonly householdController: HouseholdController,
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
		this.internalExpress.use(
			cors({
				// Reflects the request's Origin back (instead of a fixed value) when it's in the allowlist — this is
				// what lets multiple distinct frontend origins (local dev, staging, prod) share one server/config,
				// since Access-Control-Allow-Origin can only ever name one origin per response, never a list.
				// A disallowed origin resolves with allow=false (not an error) so cors just omits the
				// Access-Control-Allow-Origin header — the browser blocks the response client-side, same as any other
				// unlisted origin, instead of the request 500ing server-side.
				origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void => {
					callback(null, !origin || this.config.corsAllowedOrigins.includes(origin));
				},
				methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
				allowedHeaders: ['Content-Type'],
			}),
		);
		this.internalExpress.use(express.json());
		// Debug-level only (see PinoLogger) — a structural no-op in prod, not a conditionally-mounted one, so
		// there's no risk of it silently staying on if NODE_ENV is ever misconfigured.
		this.internalExpress.use(RequestLogger.middleware(this.logger));
		// Serves avatar files written by LocalDiskAvatarStorage — remove this once avatar storage moves to a cloud
		// bucket (URLs would then point at the bucket directly instead of this server).
		// helmet()'s default Cross-Origin-Resource-Policy: same-origin blocks the frontend (a different origin) from
		// embedding these as <img> subresources even though CORS already allows it — COEP/CORP is a separate browser
		// mechanism CORS headers don't override. Relaxed to cross-origin only here, not app-wide, since this is the
		// one route meant to be loaded cross-origin.
		this.internalExpress.use(
			'/uploads',
			express.static(path.resolve(process.cwd(), 'uploads'), {
				setHeaders: (res: Response): void => {
					res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
				},
			}),
		);
	}

	private routes(): void {
		// Swagger UI exposes route/schema structure — not something to
		// hand out in prod, so it's only mounted for dev/local.
		if (this.config.nodeEnv === 'dev' || this.config.nodeEnv === 'local') {
			this.internalExpress.use(
				'/api-docs',
				swaggerUi.serve,
				swaggerUi.setup(swaggerSpec, {
					// Within each tag, order operations GET, POST, PUT, PATCH,
					// DELETE instead of swagger-ui-express's default (by path).
					// This function is serialized to a string and evaluated client-side
					// by Swagger UI, so `a`/`b` are its internal Immutable.js operation
					// objects, not plain TS values — hence the untyped signature.
					swaggerOptions: {
						operationsSorter: (a: { get: (key: string) => string }, b: { get: (key: string) => string }): number => {
							const methodOrder = ['get', 'post', 'put', 'patch', 'delete'];
							return methodOrder.indexOf(a.get('method')) - methodOrder.indexOf(b.get('method'));
						},
					},
				}),
			);
		}

		this.internalExpress.use('/api/admin', this.adminController.router);
		this.internalExpress.use('/api/operator', this.operatorController.router);
		this.internalExpress.use('/api/household', this.householdController.router);
	}

	// Must be mounted after every route —
	// Express only invokes 4-param (error-handling) middleware for errors forwarded by something registered before it.
	private errorHandling(): void {
		this.internalExpress.use(RouteHandlers.errorHandler(this.logger));
	}
}
