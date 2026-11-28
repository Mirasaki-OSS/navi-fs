import { type RequestHandler, Router, text } from "express";
import Magic from "../../magic";
import { APIError, APIErrorCode } from "../../modules/api-errors";
import { Authentication } from "../../modules/auth";
import ResourceHandler from "../../resources/handler";
import { ResourceParser } from "../../resources/parser";
import { typedResponse } from "../../response";
import { methodNotAllowed, options } from "../methods";

const v1Router = Router();
const textBody = text({ limit: Magic.TEXT_BODY_LIMIT_BYTES });

const parseResourceBody: RequestHandler = (req, res, next) => {
  textBody(req, res, (error?: unknown) => {
    if (
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500
    ) {
      const code =
        error.status === 413
          ? APIErrorCode.PAYLOAD_TOO_LARGE
          : error.status === 415
            ? APIErrorCode.UNSUPPORTED_MEDIA_TYPE
            : APIErrorCode.BAD_REQUEST;
      const message =
        error.status === 413
          ? "Request body exceeds the allowed size"
          : error.status === 415
            ? "Unsupported request body encoding"
            : "Invalid request body";
      next(new APIError({ code, message, status: error.status }));
      return;
    }
    next(error);
  });
};

const handleResource: RequestHandler = async (req, res, next) => {
  const handler = await ResourceHandler.getInstance();
  return handler.handleRequest(req, res, next);
};

const handleSearch: RequestHandler = async (req, res, next) => {
  const handler = await ResourceHandler.getInstance();
  return handler.handleSearchRequest(req, res, next);
};

const handleExecution: RequestHandler = async (req, res, next) => {
  const handler = await ResourceHandler.getInstance();
  return handler.handleRequest(req, res, next, "execute");
};

const resourceExists: RequestHandler = async (req, _res, next) => {
  const parser = await ResourceParser.getInstance();
  if (!parser.filters.bySlug(req.params.slug)) {
    return next(
      new APIError({ code: APIErrorCode.NOT_FOUND, message: "Resource not found", status: 404 }),
    );
  }
  next();
};

const listMethods = "GET, HEAD, OPTIONS";
const resourceMethods = "GET, HEAD, POST, DELETE, OPTIONS";
const searchMethods = "GET, OPTIONS";
const executionMethods = "POST, OPTIONS";

v1Router
  .route("/")
  .get(Authentication.requireMasterAPIKey, async (_req, res) => {
    const handler = await ResourceHandler.getInstance();
    typedResponse(res, {
      data: handler.parser.slugs,
      meta: {
        count: handler.parser.slugs.length,
      },
    });
  })
  .options(options(listMethods))
  .all(methodNotAllowed(listMethods));

v1Router
  .route("/:slug/search")
  .get(Authentication.requireAuthorization("read"), handleSearch)
  .options(resourceExists, options(searchMethods))
  .all(resourceExists, methodNotAllowed(searchMethods));

v1Router
  .route("/:slug/execute")
  .post(Authentication.requireAuthorization("execute"), handleExecution)
  .options(resourceExists, options(executionMethods))
  .all(resourceExists, methodNotAllowed(executionMethods));

v1Router
  .route("/:slug")
  .get(Authentication.requireAuthorization("read"), handleResource)
  .post(Authentication.requireAuthorization("write"), parseResourceBody, handleResource)
  .delete(Authentication.requireAuthorization("delete"), handleResource)
  .options(resourceExists, options(resourceMethods))
  .all(resourceExists, methodNotAllowed(resourceMethods));

export default v1Router;
