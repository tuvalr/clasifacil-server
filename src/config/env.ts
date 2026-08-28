export type NodeEnv = 'dev' | 'local' | 'prod';

export interface Config {
  nodeEnv: NodeEnv;
  port: number;
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
    throw new Error(
      `Invalid NODE_ENV "${rawNodeEnv}". Expected one of: ${VALID_NODE_ENVS.join(', ')}`
    );
  }

  const rawPort = process.env.PORT;
  if (!rawPort) {
    missing.push('PORT');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT "${rawPort}": must be a positive number`);
  }

  return {
    nodeEnv: rawNodeEnv as NodeEnv,
    port,
  };
}
