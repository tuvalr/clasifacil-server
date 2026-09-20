import { inject, injectable } from 'inversify';
import cron from 'node-cron';
import { TYPES } from './container/types';
import { App } from './app';
import { Logger } from './logger/logger';
import { Config } from './config/env';
import { PostgresHandler } from './handlers/postgres-handler';
import { NightlyBackfillJob } from './jobs/nightly-backfill.job';

@injectable()
export class Server {
	public constructor(
		@inject(TYPES.App) private readonly app: App,
		@inject(TYPES.Logger) private readonly logger: Logger,
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.PostgresHandler) private readonly postgresHandler: PostgresHandler,
		@inject(TYPES.NightlyBackfillJob) private readonly nightlyBackfillJob: NightlyBackfillJob,
	) {}

	public async start(): Promise<void> {
		await this.postgresHandler.connect();

		this.app.express.listen(this.config.port, () => {
			this.logger.info('server listening', { nodeEnv: this.config.nodeEnv, port: this.config.port, processId: process.pid });
		});

		// Runs once daily at 02:00 server time. node-cron's schedule callback isn't awaited by the library itself,
		// so a slow run doesn't block anything else - errors inside the job are caught and logged by the job
		// itself (see NightlyBackfillJob.backfillClass), never crashing the process.
		cron.schedule('0 2 * * *', () => {
			this.nightlyBackfillJob.run().catch((error: unknown) => {
				this.logger.error('nightly backfill job crashed', { error: error instanceof Error ? error.message : error });
			});
		});
	}
}
