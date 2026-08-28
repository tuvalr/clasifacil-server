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

const config = loadConfig();
const app = createApp(config);

// container is initialized here so future bindings are resolvable
// before the server starts accepting requests.
void container;

app.listen(config.port, () => {
  console.log(`[${config.nodeEnv}] server listening on port ${config.port}`);
});
