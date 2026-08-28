import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.${process.env.NODE_ENV ?? 'dev'}`;
const result = dotenv.config({ path: path.resolve(process.cwd(), envFile) });
if (result.error) {
	throw new Error(`Failed to load env file "${envFile}": ${result.error.message}`);
}

import { Container } from 'inversify';
import { TYPES } from './types';
import { Config, loadConfig } from '../config/env';
import { Logger } from '../logger/logger';
import { PinoLogger } from '../logger/pino-logger';
import { App } from '../app';
import { Server } from '../server';
import { PostgresHandler } from '../services/postgres-handler';

const config = loadConfig();

const container = new Container();

container.bind<Config>(TYPES.Config).toConstantValue(config);
container.bind<Logger>(TYPES.Logger).to(PinoLogger).inSingletonScope();
container.bind<App>(TYPES.App).to(App).inSingletonScope();
container.bind<PostgresHandler>(TYPES.PostgresHandler).to(PostgresHandler).inSingletonScope();
container.bind<Server>(TYPES.Server).to(Server).inSingletonScope();

// Further bindings are added here as services/repositories are introduced, e.g.:
//   container.bind<SomeService>(TYPES.SomeService).to(SomeServiceImpl);

export { container };

const logger = container.get<Logger>(TYPES.Logger);
container
	.get<Server>(TYPES.Server)
	.start()
	.catch((error: unknown) => {
		logger.error('server failed to start', { error });
		process.exit(1);
	});
