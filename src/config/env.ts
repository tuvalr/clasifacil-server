export type NodeEnv = 'dev' | 'local' | 'prod';

export interface Config {
	nodeEnv: NodeEnv;
	port: number;
	corsOrigin: string;
	pgHost: string;
	pgPort: number;
	pgUser: string;
	pgPassword: string;
	pgDatabase: string;
}

const VALID_NODE_ENVS: NodeEnv[] = ['dev', 'local', 'prod'];

function isValidNodeEnv(value: string | undefined): value is NodeEnv {
	return VALID_NODE_ENVS.includes(value as NodeEnv);
}

export function loadConfig(): Config {
	const missing: string[] = [];

	const rawNodeEnv = process.env.NODE_ENV;
	if (!rawNodeEnv) {
		missing.push('NODE_ENV');
	} else if (!isValidNodeEnv(rawNodeEnv)) {
		throw new Error(`Invalid NODE_ENV "${rawNodeEnv}". Expected one of: ${VALID_NODE_ENVS.join(', ')}`);
	}

	const rawPort = process.env.PORT;
	if (!rawPort) {
		missing.push('PORT');
	}

	const rawCorsOrigin = process.env.CORS_ORIGIN;
	if (!rawCorsOrigin) {
		missing.push('CORS_ORIGIN');
	}

	const rawPgHost = process.env.PG_HOST;
	if (!rawPgHost) {
		missing.push('PG_HOST');
	}

	const rawPgPort = process.env.PG_PORT;
	if (!rawPgPort) {
		missing.push('PG_PORT');
	}

	const rawPgUser = process.env.PG_USER;
	if (!rawPgUser) {
		missing.push('PG_USER');
	}

	const rawPgPassword = process.env.PG_PASSWORD;
	if (!rawPgPassword) {
		missing.push('PG_PASSWORD');
	}

	const rawPgDatabase = process.env.PG_DATABASE;
	if (!rawPgDatabase) {
		missing.push('PG_DATABASE');
	}

	if (missing.length > 0) {
		throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
	}

	const port = Number(rawPort);
	if (Number.isNaN(port) || port <= 0) {
		throw new Error(`Invalid PORT "${rawPort}": must be a positive number`);
	}

	const pgPort = Number(rawPgPort);
	if (Number.isNaN(pgPort) || pgPort <= 0) {
		throw new Error(`Invalid PG_PORT "${rawPgPort}": must be a positive number`);
	}

	return {
		nodeEnv: rawNodeEnv as NodeEnv,
		port,
		corsOrigin: rawCorsOrigin as string,
		pgHost: rawPgHost as string,
		pgPort,
		pgUser: rawPgUser as string,
		pgPassword: rawPgPassword as string,
		pgDatabase: rawPgDatabase as string,
	};
}
