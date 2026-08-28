import { injectable } from 'inversify';
import pino, { Logger as PinoInstance } from 'pino';
import { Logger } from './logger';

@injectable()
export class PinoLogger implements Logger {
	private readonly pino: PinoInstance;

	public constructor() {
		const isPrettyEnv = process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'local';

		this.pino = pino(
			isPrettyEnv
				? {
						transport: {
							target: 'pino-pretty',
							options: {
								colorize: true,
							},
						},
					}
				: {},
		);
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
