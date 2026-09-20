import { Request, Response, NextFunction, ParamsDictionary, RequestHandler } from 'express-serve-static-core';
import { Logger } from '../../logger/logger';
import './types/express-request.type';
import { Result } from './types/result.type';

// Shared by every wrap<N>Param(s)* variant below - translates a Result into the actual res.status()/json()/end()
// call. Not exported: only the wrap<N>Param(s)* functions call it.
function sendResult<ResBody>(result: Result<ResBody>, res: Response<ResBody>): void {
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
}

export class RouteHandlers {
	// wrap<N>Param(s)* family: adapts a Result-returning handler into an Express RequestHandler. Each path param is
	// its own named positional argument, and a route needs at most one of body/query/file (never more than one,
	// checked across every route in this codebase), so each variant name encodes exactly what its handler needs:
	// how many path params (No/One/Two) plus an optional Body/Query/File suffix. A handler simply omits the
	// parameter(s) it doesn't need.
	//
	// This is fixed-arity per variant (not one generic `wrapResult(paramKeys, handler)` parameterized over a
	// path-param-count type and a body/query tuple) because a single generic version was tried first and found to
	// let TypeScript's inference break silently - either a compile error, or worse, an accepted-but-wrong
	// parameter alignment - whenever a handler omitted a parameter the generic version expected. Verified directly
	// against this project's tsconfig; see docs/superpowers/specs/2026-09-20-controller-result-signatures-design.md
	// for the original (now-superseded) single-wrapper design this replaced.

	public static wrapNoParams<ResBody>(handler: () => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody> {
		return (_req: Request<ParamsDictionary, ResBody>, res: Response<ResBody>, next: NextFunction): void => {
			handler()
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapNoParamsBody<ResBody, ReqBody>(handler: (body: ReqBody) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody, ReqBody> {
		return (req: Request<ParamsDictionary, ResBody, ReqBody>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.body)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapNoParamsQuery<ResBody, ReqQuery>(handler: (query: ReqQuery) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody, unknown, ReqQuery> {
		return (req: Request<ParamsDictionary, ResBody, unknown, ReqQuery>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.query)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapOneParam<ResBody>(paramKey: string, handler: (id: string) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody> {
		return (req: Request<ParamsDictionary, ResBody>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.params[paramKey] as string)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapOneParamBody<ResBody, ReqBody>(paramKey: string, handler: (id: string, body: ReqBody) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody, ReqBody> {
		return (req: Request<ParamsDictionary, ResBody, ReqBody>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.params[paramKey] as string, req.body)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapOneParamQuery<ResBody, ReqQuery>(paramKey: string, handler: (id: string, query: ReqQuery) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody, unknown, ReqQuery> {
		return (req: Request<ParamsDictionary, ResBody, unknown, ReqQuery>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.params[paramKey] as string, req.query)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	// req.file is populated by a multer middleware (e.g. avatarUpload) that must run ahead of this wrapper in the
	// route's middleware chain - multer parses the multipart body into req.file, which is why this variant doesn't
	// also accept a body: an upload route's body IS the file, there's nothing left over to bind as JSON.
	public static wrapOneParamFile<ResBody>(paramKey: string, handler: (id: string, file: Express.Multer.File | undefined) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody> {
		return (req: Request<ParamsDictionary, ResBody> & { file?: Express.Multer.File }, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.params[paramKey] as string, req.file)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapTwoParams<ResBody>(paramKeys: readonly [string, string], handler: (a: string, b: string) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody> {
		return (req: Request<ParamsDictionary, ResBody>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.params[paramKeys[0]] as string, req.params[paramKeys[1]] as string)
				.then((result: Result<ResBody>): void => sendResult(result, res))
				.catch(next);
		};
	}

	public static wrapTwoParamsBody<ResBody, ReqBody>(paramKeys: readonly [string, string], handler: (a: string, b: string, body: ReqBody) => Promise<Result<ResBody>>): RequestHandler<ParamsDictionary, ResBody, ReqBody> {
		return (req: Request<ParamsDictionary, ResBody, ReqBody>, res: Response<ResBody>, next: NextFunction): void => {
			handler(req.params[paramKeys[0]] as string, req.params[paramKeys[1]] as string, req.body)
				.then((result: Result<ResBody>): void => sendResult(result, res))
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
