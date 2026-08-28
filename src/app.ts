import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Future controller routers are mounted here, e.g.:
  //   app.use('/api', controllerRouter);

  return app;
}
