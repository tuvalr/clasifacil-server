import { Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

// Express doesn't await async route handlers itself — a rejected promise
// from one is silently swallowed rather than forwarded to error-handling
// middleware. Wrapping a handler with this forwards any thrown/rejected
// error to next(err) instead, so the global error handler (see
// error-handler.ts) always sees it.
export function asyncHandler(handler: AsyncRequestHandler): AsyncRequestHandler {
	return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
		try {
			await handler(req, res, next);
		} catch (error) {
			next(error);
		}
	};
}
