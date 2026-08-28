import { Pool, QueryResultRow } from 'pg';
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { Config } from '../config/env';
import { Logger } from '../logger/logger';

@injectable()
export class PostgresHandler {
	private readonly pool: Pool;

	public constructor(
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.Logger) private readonly logger: Logger,
	) {
		this.pool = new Pool({
			host: this.config.pgHost,
			port: this.config.pgPort,
			user: this.config.pgUser,
			password: this.config.pgPassword,
			database: this.config.pgDatabase,
		});
	}

	public async connect(): Promise<void> {
		await this.pool.query('SELECT 1');
		this.logger.info('postgres connected', { host: this.config.pgHost, database: this.config.pgDatabase });
	}

	public async disconnect(): Promise<void> {
		await this.pool.end();
		this.logger.info('postgres disconnected');
	}

	public async query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
		const result = await this.pool.query<T>(sql, params);
		return result.rows;
	}
}
