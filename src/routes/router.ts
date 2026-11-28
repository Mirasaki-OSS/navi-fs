import { type NextFunction, type Request, type Response, Router } from "express";
import { logger } from "../logger";
import { APIError, APIErrorCode } from "../modules/api-errors";
import { typedResponse } from "../response";
import { methodNotAllowed, options } from "./methods";
import v1Router from "./v1/routes";

const router = Router();

const healthMethods = "GET, HEAD, OPTIONS";
router
  .route("/")
  .get((_req, res) => {
    typedResponse(res, {
      data: {
        status: "alive",
      },
    });
    logger.debug("Received status request: alive");
  })
  .options(options(healthMethods))
  .all(methodNotAllowed(healthMethods));

router.use("/api/v1", v1Router);

router.use((_req, _res, next) => {
  next(new APIError({ code: APIErrorCode.NOT_FOUND, message: "Resource not found", status: 404 }));
});

export const errorHandler = (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  res.removeHeader("Content-Type");
  res.removeHeader("Content-Length");
  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Encoding");
  if (err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
    typedResponse(
      res,
      new APIError({ code: APIErrorCode.NOT_FOUND, message: "Resource not found", status: 404 }),
    );
    return;
  }
  if (err instanceof Error && "status" in err && err.status === 416) {
    typedResponse(
      res,
      new APIError({ code: APIErrorCode.RANGE_NOT_SATISFIABLE, message: "Range not satisfiable" }),
    );
    return;
  }
  if (err instanceof Error && "status" in err && err.status === 412) {
    typedResponse(
      res,
      new APIError({ code: APIErrorCode.PRECONDITION_FAILED, message: "Precondition failed" }),
    );
    return;
  }
  if (err instanceof APIError) {
    typedResponse(res, err, err.status);
  } else {
    logger.error({ err }, "Unhandled request error");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "development"
            ? typeof err === "object" && err !== null
              ? (err as Error).message
              : String(err)
            : "An unexpected error occurred",
      },
    });
  }
};

// Router-level error handler catches errors from routes and sub-routes
router.use(errorHandler);

export default router;
