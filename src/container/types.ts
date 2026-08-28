// Symbol identifiers for Inversify bindings.
// Add entries here as services/repositories are introduced, e.g.:
//   SomeService: Symbol.for('SomeService'),
export const TYPES = {
	Logger: Symbol.for('Logger'),
	Config: Symbol.for('Config'),
	App: Symbol.for('App'),
	Server: Symbol.for('Server'),
	PostgresHandler: Symbol.for('PostgresHandler'),
};
