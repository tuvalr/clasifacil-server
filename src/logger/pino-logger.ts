import { injectable } from 'inversify';
import pino, { Logger as PinoInstance } from 'pino';
import { Logger } from './logger';

@injectable()
export class PinoLogger implements Logger {
	private readonly pino: PinoInstance;

	public constructor() {
		const isPrettyEnv = process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'local';

		this.pino = pino({
			// pino's default base bindings add { pid, hostname } to every
			// log line - dropped so only the explicit "server listening"
			// call (which passes pid itself) shows a process ID.
			base: null,
			// Default level is 'info', which silently drops .debug() calls - raised to 'debug' in
			// dev/local so RequestLogger's per-request input/output logs actually emit there, while
			// prod stays at 'info' so those same calls are structurally never emitted, not just filtered
			// by some other guard.
			level: isPrettyEnv ? 'debug' : 'info',
			...(isPrettyEnv
				? {
						transport: {
							target: 'pino-pretty',
							options: {
								colorize: true,
							},
						},
					}
				: {}),
		});
	}

	public info(message: string, meta?: Record<string, unknown>): void {
		this.pino.info(meta ?? {}, message);
	}

	public warn(message: string, meta?: Record<string, unknown>): void {
		this.pino.warn(meta ?? {}, message);
	}

	public error(message: string, meta?: Record<string, unknown>): void {
		this.pino.error(meta ?? {}, message);
	}

	public debug(message: string, meta?: Record<string, unknown>): void {
		this.pino.debug(meta ?? {}, message);
	}
}
