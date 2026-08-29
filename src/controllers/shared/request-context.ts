// Augments Express's Request with the per-request correlation ID set by
// requestIdMiddleware, so it can be read (req.correlationId) anywhere a
// request flows — route handlers, the global error handler, future
// logging middleware — without threading it through as a parameter.
declare module 'express-serve-static-core' {
	interface Request {
		correlationId: string;
	}
}

export {};
