import { inject, injectable } from 'inversify';
import { TYPES } from './container/types';
import { App } from './app';
import { Logger } from './logger/logger';
import { Config } from './config/env';

@injectable()
export class Server {
	public constructor(
		@inject(TYPES.App) private readonly app: App,
		@inject(TYPES.Logger) private readonly logger: Logger,
		@inject(TYPES.Config) private readonly config: Config,
	) {}

	public start(): void {
		this.app.express.listen(this.config.port, () => {
			this.logger.info('server listening', { nodeEnv: this.config.nodeEnv, port: this.config.port });
		});
	}
}
