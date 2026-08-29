import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { Logger } from '../logger/logger';

@injectable()
export class EnvHandler {
	public constructor(@inject(TYPES.Logger) private readonly logger: Logger) {}

	// TODO: Replace with a real secrets-manager implementation.
	// This currently does nothing beyond logging, because dotenv (called
	// before this runs, in inversify.config.ts) already populates
	// process.env from the local .env.<NODE_ENV> file. A real
	// implementation needs to:
	//   1. Fetch secrets (e.g. PG_PASSWORD) from AWS Secrets Manager,
	//      using the IAM role available at runtime (no access keys).
	//   2. Populate process.env with the fetched values, the same way
	//      dotenv does, before loadConfig() reads them.
	// This method must keep running before loadConfig() in
	// inversify.config.ts — Config is built once from process.env at
	// container-construction time, so anything fetched after that point
	// would never reach the already-built Config.
	public async load(): Promise<void> {
		await Promise.resolve();
		this.logger.info('env handler: using local .env values (no-op)');
	}
}
