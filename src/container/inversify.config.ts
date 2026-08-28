import 'reflect-metadata';
import { Container } from 'inversify';
import { TYPES } from './types';
import { Logger } from '../logger/logger';
import { PinoLogger } from '../logger/pino-logger';

const container = new Container();

container.bind<Logger>(TYPES.Logger).to(PinoLogger).inSingletonScope();

// Further bindings are added here as services/repositories are introduced, e.g.:
//   container.bind<SomeService>(TYPES.SomeService).to(SomeServiceImpl);

export { container };
