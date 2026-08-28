import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.${process.env.NODE_ENV ?? 'dev'}`;
const result = dotenv.config({ path: path.resolve(process.cwd(), envFile) });
if (result.error) {
	throw new Error(`Failed to load env file "${envFile}": ${result.error.message}`);
}

import { loadConfig } from './config/env';
import { createApp } from './app';
import { container } from './container/inversify.config';
import { TYPES } from './container/types';
import { Logger } from './logger/logger';

const config = loadConfig();
const app = createApp(config);
const logger = container.get<Logger>(TYPES.Logger);

app.listen(config.port, () => {
	logger.info('server listening', { nodeEnv: config.nodeEnv, port: config.port });
});
