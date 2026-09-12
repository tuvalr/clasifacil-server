import { Request, Response, NextFunction } from 'express';
import { Logger } from '../../logger/logger';
import './types/express-request.type';

export class RequestLogger {
	// Mounted after RequestContext.middleware (needs req.correlationId) and express.json() (needs req.body
	// parsed). Logs are debug-level, so this is a no-op in prod (PinoLogger only raises the level to 'debug'
	// in dev/local) — safe to mount unconditionally rather than gating on NODE_ENV here too.
	public static middleware(logger: Logger) {
		return (req: Request, res: Response, next: NextFunction): void => {
			// req.params isn't populated yet at this point — this middleware runs before Express has matched the
			// route inside the mounted sub-routers, so route params only exist once the request has actually
			// reached its handler. Logged on the response line instead, once routing has definitely completed.
			logger.debug('request', {
				correlationId: req.correlationId,
				method: req.method,
				path: req.originalUrl,
				query: req.query,
				body: req.body,
			});

			const originalJson = res.json.bind(res);
			let responseBody: unknown;
			res.json = (body?: unknown): Response => {
				responseBody = body;
				return originalJson(body);
			};

			// 'finish' (not returning from the handler) is what actually fires once the response is fully sent,
			// covering routes that call res.end() directly (no body) as well as ones that call res.json().
			res.on('finish', () => {
				logger.debug('response', {
					correlationId: req.correlationId,
					method: req.method,
					path: req.originalUrl,
					params: req.params,
					statusCode: res.statusCode,
					body: responseBody,
				});
			});

			next();
		};
	}
}
