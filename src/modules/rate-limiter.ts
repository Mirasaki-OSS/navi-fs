import type { RequestHandler } from "express";
import { type RateLimiterAbstract, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { logger } from "../logger";
import Magic from "../magic";
import { APIError, APIErrorCode } from "./api-errors";

/**
 * Block Strategy against really powerful DDoS attacks (like 100k requests per sec)
 * ref: {@link https://github.com/animir/node-rate-limiter-flexible/wiki/In-memory-Block-Strategy}
 */
export const shortBurstRateLimiter = new RateLimiterMemory({
  points: Magic.SHORT_BURST_RATE_LIMIT_POINTS,
  duration: Magic.SHORT_BURST_RATE_LIMIT_DURATION_SECONDS,
});

const rateLimiterMiddleware =
  (limiter: RateLimiterAbstract): RequestHandler =>
  async (req, res, next) => {
    const ip = req.ip;
    if (!ip) {
      logger.error("Cannot determine client IP for rate limiting");
      next(
        new APIError({
          code: APIErrorCode.INTERNAL_ERROR,
          message: "Cannot determine client IP",
          status: 500,
        }),
      );
      return;
    }

    let result: RateLimiterRes;
    try {
      result = await limiter.consume(ip);
    } catch (error: unknown) {
      if (!(error instanceof RateLimiterRes)) {
        logger.error({ err: error }, "Rate limiter failed");
        next(
          new APIError({
            code: APIErrorCode.INTERNAL_ERROR,
            message: "Rate limiter failed",
            status: 500,
          }),
        );
        return;
      }

      const rlHeaders = {
        "Retry-After": error.msBeforeNext / Magic.MS_IN_ONE_SECOND,
        "X-RateLimit-Limit": limiter.points,
        "X-RateLimit-Remaining": error.remainingPoints,
        "X-RateLimit-Consumed": error.consumedPoints,
        "X-RateLimit-Reset": new Date(Date.now() + error.msBeforeNext),
      };
      res.set(rlHeaders);
      logger.debug({
        message: `Rate limit reached for IP: ${ip}`,
        headers: rlHeaders,
      });
      next(
        new APIError({
          code: APIErrorCode.TOO_MANY_REQUESTS,
          message: "Rate limit reached",
          status: 429,
          details: rlHeaders,
        }),
      );
      return;
    }

    const rlHeaders = {
      "X-RateLimit-Next": result.msBeforeNext / Magic.MS_IN_ONE_SECOND,
      "X-RateLimit-Limit": limiter.points,
      "X-RateLimit-Remaining": result.remainingPoints,
      "X-RateLimit-Consumed": result.consumedPoints,
      "X-RateLimit-Reset": new Date(Date.now() + result.msBeforeNext),
    };
    res.set(rlHeaders);
    logger.debug({
      message: `Rate limit headers for IP: ${ip}`,
      headers: rlHeaders,
    });
    next();
  };

export default rateLimiterMiddleware;
