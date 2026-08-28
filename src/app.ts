import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { Config } from './config/env';

export function createApp(config: Config): Express {
	const app = express();

	app.use(helmet());
	app.use(cors({ origin: config.corsOrigin }));
	app.use(express.json());

	// Future controller routers are mounted here, e.g.:
	//   app.use('/api', controllerRouter);

	return app;
}
