import 'reflect-metadata';
import { Container } from 'inversify';

const container = new Container();

// Bindings are added here as services/repositories are introduced, e.g.:
//   container.bind<SomeService>(TYPES.SomeService).to(SomeServiceImpl);

export { container };
