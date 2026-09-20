import { Request, Response, NextFunction, ParamsDictionary, RequestHandler } from 'express-serve-static-core';
import { Logger } from '../../logger/logger';
import './types/express-request.type';
import { Result } from './types/result.type';

type AsyncRequestHandler<P = ParamsDictionary, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown> = (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction) => Promise<void>;

type ParamValues<PK extends readonly string[]> = { [I in keyof PK]: string };

export class RouteHandlers {
	// Express doesn't await async route handlers itself - a rejected promise from one is silently swallowed rather than forwarded to
	// error-handling middleware. Wrapping a handler with this forwards any thrown/rejected error to next(err) instead, so errorHandler
	// below always sees it. Generic over Express's own RequestHandler type parameters (P/ResBody/ReqBody/ReqQuery) - matching
	// RequestHandler's shape exactly (not a custom Request/Response pairing) is what lets router.get/post/etc. unify route-specific
	// types (see src/controllers/types/) through wrap() instead of widening back to the untyped defaults.
	public static wrap<P = ParamsDictionary, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(handler: AsyncRequestHandler<P, ResBody, ReqBody, ReqQuery>): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
		return (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req, res, next).catch(next);
		};
	}

	// Adapts a Result-returning handler into an Express RequestHandler. Each path param becomes its own named
	// positional argument on the handler (see docs/superpowers/specs/2026-09-20-controller-result-signatures-design.md)
	// rather than a single params object, so paramKeys carries the route's param names in path order and this
	// spreads req.params's values (looked up by those names) ahead of body/query when calling the handler.
	public static wrapResult<PK extends readonly string[], ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
		paramKeys: readonly [...PK],
		handler: (...args: [...ParamValues<PK>, ReqBody, ReqQuery]) => Promise<Result<ResBody>>,
	): RequestHandler<ParamsDictionary, ResBody, ReqBody, ReqQuery> {
		return (req: Request<ParamsDictionary, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction): void => {
			const paramValues = paramKeys.map((key: string) => req.params[key]) as ParamValues<PK>;
			(handler as (...args: unknown[]) => Promise<Result<ResBody>>)(...paramValues, req.body, req.query)
				.then((result: Result<ResBody>): void => {
					switch (result.status) {
						case 204:
						case 404:
							res.status(result.status).end();
							return;
						case 200:
						case 201:
							res.status(result.status).json(result.body);
							return;
						case 400:
							if (result.error === undefined) {
								res.status(400).end();
								return;
							}
							res.status(400).json((result.details ? { error: result.error, details: result.details } : { error: result.error }) as ResBody);
							return;
						case 409: {
							// Copy-then-delete (not destructuring) - a `const { status: _status, ...body } = result`
							// compiles fine but trips this project's no-unused-vars on the unused `_status` binding.
							const body: Record<string, unknown> = { ...result };
							delete body.status;
							res.status(409).json(body as ResBody);
							return;
						}
					}
				})
				.catch(next);
		};
	}

	// Temporary placeholder for routes that are not yet implemented. Ends the response instead of leaving it genuinely empty: a handler that
	// never calls res.end()/res.send()/res.json() hangs the connection open until the client or a reverse proxy times it out.
	public static notImplemented(this: void, req: Request, res: Response): void {
		res.status(501).end();
	}

	// Express identifies error-handling middleware solely by arity (4-params) - an unused `next` is required here even though it's never
	// called, otherwise Express treats this as a normal (3-param) handler and never invokes it for a forwarded error.
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
