import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { inject, injectable } from 'inversify';
import { TYPES } from './container/types';
import { Config } from './config/env';

@injectable()
export class App {
	private readonly internalExpress: Express;

	public constructor(@inject(TYPES.Config) private readonly config: Config) {
		this.internalExpress = express();
		this.middleware();
	}

	public get express(): Express {
		return this.internalExpress;
	}

	private middleware(): void {
		this.internalExpress.use(helmet());
		this.internalExpress.use(cors({ origin: this.config.corsOrigin }));
		this.internalExpress.use(express.json());

		// Future controller routers are mounted here, e.g.:
		//   this.internalExpress.use('/api', controllerRouter);
	}
}
