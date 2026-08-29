import { Request, Response, NextFunction } from 'express';
import { Logger } from '../../logger/logger';
import './request-context';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export class RouteHandlers {
	// Express doesn't await async route handlers itself — a rejected
	// promise from one is silently swallowed rather than forwarded to
	// error-handling middleware. Wrapping a handler with this forwards
	// any thrown/rejected error to next(err) instead, so errorHandler
	// below always sees it.
	public static wrap(handler: AsyncRequestHandler): AsyncRequestHandler {
		return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
			try {
				await handler(req, res, next);
			} catch (error) {
				next(error);
			}
		};
	}

	// Temporary placeholder for routes that are not yet implemented. Ends
	// the response instead of leaving it genuinely empty: a handler that
	// never calls res.end()/res.send()/res.json() hangs the connection
	// open until the client or a reverse proxy times it out.
	public static notImplemented(this: void, req: Request, res: Response): void {
		res.status(501).end();
	}

	// Express identifies error-handling middleware solely by arity (4
	// params) — an unused `next` is required here even though it's never
	// called, otherwise Express treats this as a normal (3-param) handler
	// and never invokes it for a forwarded error.
	public static errorHandler(logger: Logger) {
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
}
