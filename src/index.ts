import rTracer from 'cls-rtracer';
import compression from 'compression';
import express, { Request, Response } from 'express';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import Magic from './magic';
import rateLimiterMiddleware, { shortBurstRateLimiter } from './modules/rate-limiter';
import appConfig from './resources/config';
import ResourceHandler from './resources/handler';
import router from './routes/router';

const app = express();

export const main = async (
  preventServerStart = false,
) => {
  const start = process.hrtime();
  const compressionFilter = (req: Request, res: Response) => req.headers['x-no-compression'] || res.statusCode === 206 ? false : compression.filter(req, res);

  await ResourceHandler.getInstance();

  app.use(pinoHttp({
    autoLogging: true,
    level: appConfig['log-level'],
    genReqId: () => rTracer.id,
    logger,
  }));
  app.use(compression({ filter: compressionFilter }));
  app.use(rTracer.expressMiddleware());
  app.use(rateLimiterMiddleware(shortBurstRateLimiter));
  app.use(router);

  if (preventServerStart) {
    return app;
  }
  else return app.listen(appConfig.port, () => {
    logger.info(`[NaviFS] Listening on port ${appConfig.port}`);
    const msSinceStart = (process.hrtime(start)[1] / Magic.MS_IN_ONE_NS).toFixed(2);
    logger.debug(`Listening on port ${appConfig.port} after ${msSinceStart}ms`);
  });
};

if (require.main === module) {
  void main();
}
