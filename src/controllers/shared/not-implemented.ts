import { Request, Response } from 'express';

// Ends the response instead of leaving it genuinely empty: a handler
// that never calls res.end()/res.send()/res.json() hangs the connection
// open until the client or a reverse proxy times it out.
export function notImplemented(req: Request, res: Response): void {
	res.status(501).end();
}
