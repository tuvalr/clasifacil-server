import { Request, Response, NextFunction } from 'express';
import { Logger } from '../../logger/logger';
import './request-context';

// Express identifies error-handling middleware solely by arity (4
// params) — an unused `next` is required here even though it's never
// called, otherwise Express treats this as a normal (3-param) handler
// and never invokes it for a forwarded error.
export function createErrorHandler(logger: Logger) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express identifies error middleware by 4-param arity; next must be declared even though it's never called
	return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
		const correlationId = req.correlationId;
		logger.error('unhandled controller error', {
			correlationId,
			method: req.method,
			path: req.path,
			error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
		});
		res.status(500).json({ error: 'Internal Server Error', correlationId });
	};
}
