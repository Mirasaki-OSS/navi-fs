import type { RequestHandler } from "express";
import { APIError, APIErrorCode } from "../modules/api-errors";

export const options =
  (allowed: string): RequestHandler =>
  (_req, res) => {
    res.setHeader("Allow", allowed);
    res.status(204).end();
  };

export const methodNotAllowed =
  (allowed: string): RequestHandler =>
  (_req, res, next) => {
    res.setHeader("Allow", allowed);
    next(
      new APIError({
        code: APIErrorCode.METHOD_NOT_ALLOWED,
        message: "Method not allowed",
        status: 405,
      }),
    );
  };
