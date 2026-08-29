import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import './request-context';

// Mounted first, before any route: gives every request a correlation ID
// available to every log line during that request (not just an error
// one) via req.correlationId, and echoes it back as a response header
// so a caller can report it if something goes wrong.
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
	req.correlationId = randomUUID();
	res.setHeader('X-Correlation-Id', req.correlationId);
	next();
}
