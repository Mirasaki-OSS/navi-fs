import express from "express";
import { RateLimiterMemory, type RateLimiterRes } from "rate-limiter-flexible";
import rateLimiterMiddleware from "../src/modules/rate-limiter";
import router, { errorHandler } from "../src/routes/router";

class FailingLimiter extends RateLimiterMemory {
  override consume(): Promise<RateLimiterRes> {
    return Promise.reject(
      Object.assign(new Error("Rate limiter backend unavailable"), { code: "ENOENT" }),
    );
  }
}

class RejectingLimiter extends RateLimiterMemory {
  override consume(): Promise<RateLimiterRes> {
    return Promise.reject(undefined);
  }
}

const app = express();
const limiter = rateLimiterMiddleware(new RateLimiterMemory({ points: 1, duration: 60 }));
app.get("/limited", limiter, (_req, res) => {
  res.sendStatus(200);
});
app.get(
  "/missing-ip",
  (req, _res, next) => {
    Object.defineProperty(req, "ip", { value: undefined });
    next();
  },
  limiter,
);
app.get("/backend-error", rateLimiterMiddleware(new FailingLimiter({ points: 1, duration: 60 })));
app.get(
  "/non-error-rejection",
  rateLimiterMiddleware(new RejectingLimiter({ points: 1, duration: 60 })),
);
app.use(router);
app.use(errorHandler);

const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string" || !process.send) {
    throw new Error("Unable to report test server address");
  }
  process.send(address.port);
});
