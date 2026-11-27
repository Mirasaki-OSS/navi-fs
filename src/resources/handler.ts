import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../logger";
import Magic from "../magic";
import { APIError, APIErrorCode } from "../modules/api-errors";
import { typedResponse } from "../response";
import { type ParsedResource, ResourceParser } from "./parser";
import type { CacheControlPolicy } from "./schema";
import { ResourceUtils } from "./utils";

const hashAny = (data: unknown): string =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");

class ResourceHandler {
  private static instance: ResourceHandler | null = null;
  public static async getInstance(): Promise<ResourceHandler> {
    if (!ResourceHandler.instance) {
      ResourceHandler.instance = new ResourceHandler(await ResourceParser.getInstance());
    }
    return ResourceHandler.instance;
  }

  private constructor(public readonly parser: ResourceParser) {}

  static buildCacheControlHeader(cacheControlPolicy: CacheControlPolicy | null): string {
    const directives: string[] = [];

    if (!cacheControlPolicy) {
      return "no-store";
    }

    if (cacheControlPolicy["max-age"]) {
      directives.push(`max-age=${cacheControlPolicy["max-age"]}`);
    }

    if (cacheControlPolicy["s-maxage"]) {
      directives.push(`s-maxage=${cacheControlPolicy["s-maxage"]}`);
    }

    if (cacheControlPolicy["no-cache"]) {
      directives.push("no-cache");
    }

    if (cacheControlPolicy["no-store"]) {
      directives.push("no-store");
    }

    if (cacheControlPolicy["stale-while-revalidate"]) {
      directives.push(`stale-while-revalidate=${cacheControlPolicy["stale-while-revalidate"]}`);
    }

    if (cacheControlPolicy["stale-if-error"]) {
      directives.push(`stale-if-error=${cacheControlPolicy["stale-if-error"]}`);
    }

    if (cacheControlPolicy.public) {
      directives.push("public");
    }

    if (cacheControlPolicy.private) {
      directives.push("private");
    }

    if (cacheControlPolicy.immutable) {
      directives.push("immutable");
    }

    return directives.length > 0 ? directives.join(", ") : "no-store";
  }

  private static async getResourceFile(
    resource: ParsedResource,
    query: {
      cursor: string | null;
    },
  ): Promise<string> {
    if (resource.type === "file") {
      if (!resource.extensions?.length) {
        return resource.target;
      }

      const promises = resource.extensions.map(async (ext) => {
        const filePath = `${resource.target}.${ext}`;
        const fileExists = await ResourceUtils.checkFileExists(filePath);
        if (fileExists) {
          return filePath;
        }
        return null;
      });

      const results = await Promise.all(promises);
      const validResult = results.find((result) => result !== null);

      if (!validResult) {
        throw new APIError({
          code: APIErrorCode.NOT_FOUND,
          message: "File not found",
          status: 404,
          details: {
            slug: resource.slug,
            query,
          },
        });
      }

      return validResult;
    }

    throw new Error(
      'Directory resources are not supported through this method, use "listFiles" instead.',
    );
  }

  private readonly handleGetRequest = async (
    resource: ParsedResource,
    query: {
      recursive: boolean;
      currentLocation: string;
      type: string | null;
    },
    req: Request,
    res: Response,
  ): Promise<void> => {
    const { currentLocation, recursive, type: responseType } = query;
    const stats = await stat(currentLocation);
    const currentIsFile = stats.isFile();
    const directoryResourceIsInFile = resource.type === "directory" && currentIsFile;
    res.setHeader(
      "Cache-Control",
      ResourceHandler.buildCacheControlHeader(resource["cache-control"]),
    );

    logger.debug({
      message: `[GET] Resource found: ${resource.slug}`,
      resource,
      query,
      recursive,
      responseType,
      currentLocation,
      currentIsFile,
      ...stats,
    });

    if (resource.type === "file" || directoryResourceIsInFile) {
      if (responseType === "stream") {
        res.attachment(path.basename(currentLocation));
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Accept-Ranges", "bytes");
      } else {
        res.setHeader("Content-Disposition", "inline");
      }

      const etag = `W/"${hashAny(`${responseType}-${stats.dev}-${stats.ino}-${stats.size}-${stats.mtimeMs}`)}"`;
      const ifMatch = req.headers["if-match"];
      const ifUnmodifiedSince = req.headers["if-unmodified-since"];
      const unmodifiedSince =
        typeof ifUnmodifiedSince === "string" ? Date.parse(ifUnmodifiedSince) : Number.NaN;
      if (
        (ifMatch && ifMatch !== "*") ||
        (!ifMatch &&
          Number.isFinite(unmodifiedSince) &&
          Math.floor(stats.mtimeMs / Magic.MS_IN_ONE_SECOND) * Magic.MS_IN_ONE_SECOND >
            unmodifiedSince)
      ) {
        throw new APIError({
          code: APIErrorCode.PRECONDITION_FAILED,
          message: "Precondition failed",
        });
      }
      const bypassCache =
        req.headers["cache-control"] === "no-cache" || req.headers.pragma === "no-cache";

      res.setHeader("ETag", etag);
      res.setHeader("Last-Modified", stats.mtime.toUTCString());

      if (responseType === "stream") {
        const ifRange = req.headers["if-range"];
        const ifRangeDate =
          typeof ifRange === "string" && !ifRange.includes('"') ? Date.parse(ifRange) : Number.NaN;
        const rangeIsFresh =
          req.method !== "HEAD" &&
          (!ifRange ||
            (Number.isFinite(ifRangeDate) &&
              Math.floor(stats.mtimeMs / Magic.MS_IN_ONE_SECOND) * Magic.MS_IN_ONE_SECOND ===
                ifRangeDate &&
              Date.now() - stats.mtimeMs >= Magic.MIN_STRONG_LAST_MODIFIED_AGE_MS));
        if (req.headers.pragma === "no-cache") {
          req.headers["cache-control"] = `${req.headers["cache-control"] ?? ""}, no-cache`;
        }
        res.sendFile(currentLocation, {
          dotfiles: "allow",
          cacheControl: false,
          acceptRanges: rangeIsFresh,
        });
        return;
      }

      if (!bypassCache && req.fresh) {
        res.status(304).end();
        return;
      }

      const { data: rawData, meta } = await ResourceUtils.readFile(currentLocation);
      const { data, truncated } = ResourceUtils.applySizePolicy(
        rawData,
        currentLocation,
        resource["size-policy"],
      );

      if (truncated) {
        logger.warn({
          message: `File ${currentLocation} was truncated due to size policy`,
          originalSize: rawData.length,
          truncatedSize: data.length,
        });
      }

      if (responseType === "json") {
        typedResponse(res, {
          data,
          meta: { ...meta, truncated },
        });
      } else {
        if (responseType === "text") {
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
        } else if (responseType === "html") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
        } else if (responseType === "xml") {
          res.setHeader("Content-Type", "application/xml");
        } else if (responseType === "csv") {
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
        } else if (responseType === "yaml") {
          res.setHeader("Content-Type", "application/x-yaml");
        } else if (responseType === "toml") {
          res.setHeader("Content-Type", "application/toml");
        } else {
          res.setHeader("Content-Type", "application/octet-stream");
        }
        res.send(data);
      }

      return;
    }

    const absolutePaths = await ResourceUtils.listFiles(
      currentLocation,
      recursive,
      resource.extensions ?? [],
      resource.target,
    );
    const relativePaths = absolutePaths.map((filePath) => path.relative(currentLocation, filePath));
    const { data: filteredPaths, truncated } = ResourceUtils.applySizePolicy(
      relativePaths,
      null,
      resource["size-policy"],
    );

    if (truncated) {
      logger.warn({
        message: `Directory listing for ${resource.slug} was truncated due to size policy`,
        originalCount: relativePaths.length,
        truncatedCount: filteredPaths.length,
      });
    }

    logger.debug({
      message: `Resolving (route) options for: ${resource.slug}`,
      absolutePaths,
      relativePaths: filteredPaths,
      truncated,
    });

    typedResponse(res, {
      data: filteredPaths,
      meta: {
        slug: resource.slug,
        query,
        currentLocation,
        recursive,
        responseType,
        truncated,
      },
    });
  };

  private readonly handlePostRequest = async (
    resource: ParsedResource,
    query: {
      currentLocation: string;
      encoding?: BufferEncoding | null | undefined;
    },
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { currentLocation, encoding } = query;
    const stats = await stat(currentLocation);
    const currentIsFile = stats.isFile();

    if (!currentIsFile) {
      next(
        new APIError({
          code: APIErrorCode.BAD_REQUEST,
          message: "Invalid request",
          status: 400,
          details: {
            slug: resource.slug,
            query,
            error: "The current target/cursor is not a file, and cannot be written to",
          },
        }),
      );
      return;
    }

    logger.debug({
      message: `[POST] Resource found: ${resource.slug}`,
      resource,
      query,
      currentLocation,
      currentIsFile,
      ...stats,
    });

    if (typeof req.body !== "string") {
      next(
        new APIError({
          code: APIErrorCode.BAD_REQUEST,
          message: "Invalid request",
          status: 400,
          details: {
            slug: resource.slug,
            query,
            error: "The request body is not a string, and cannot be written to the file",
          },
        }),
      );
      return;
    }

    await ResourceUtils.writeFile(currentLocation, req.body, { encoding });

    res.status(201).end();
  };

  private readonly handleDeleteRequest = async (
    resource: ParsedResource,
    query: {
      currentLocation: string;
      force: boolean;
    },
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { currentLocation, force } = query;
    const stats = await stat(currentLocation);
    const currentIsFile = stats.isFile();

    if (!currentIsFile && !force) {
      next(
        new APIError({
          code: APIErrorCode.BAD_REQUEST,
          message: "Invalid request",
          status: 400,
          details: {
            slug: resource.slug,
            query,
            error:
              'The current target/cursor is not a file, and cannot be deleted. Use "force" to delete directories',
          },
        }),
      );
      return;
    }

    logger.debug({
      message: `[DELETE] Resource found: ${resource.slug}`,
      resource,
      query,
      currentLocation,
      currentIsFile,
      ...stats,
    });

    await ResourceUtils.deleteTarget(currentLocation, currentIsFile ? "file" : "directory");

    res.status(204).end();
  };

  private readonly handleExecuteSSERequest = (
    resource: ParsedResource,
    query: { cwd?: string | undefined },
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!resource.executable) {
      next(
        new APIError({
          code: APIErrorCode.BAD_REQUEST,
          message: "Invalid request",
          status: 400,
          details: {
            slug: resource.slug,
            query,
            error: "The resource is not executable",
          },
        }),
      );
      return;
    }

    const { command, args, env, cwd, timeout, detached, shell } = resource.executable;
    const executionCwd = query.cwd ?? cwd;

    logger.debug({
      message: `[EXECUTE:SSE] Running command: ${resource.slug}`,
      resource,
      query,
      command,
      args,
      env,
      cwd: executionCwd,
      timeout,
      detached,
      shell,
    });

    const sendEvent = (type: string, data: string) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${type}\n`);
      res.write(`data: ${data.replace(/\n/g, "\ndata: ")}\n\n`);
    };

    try {
      const child = spawn(command, Array.isArray(args) ? args : [args], {
        cwd: executionCwd,
        env,
        shell,
        detached,
        timeout: timeout * Magic.MS_IN_ONE_SECOND,
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      child.stdout.on("data", (chunk) => {
        sendEvent("stdout", chunk.toString());
      });

      child.stderr.on("data", (chunk) => {
        sendEvent("stderr", chunk.toString());
      });

      child.on("close", (code, signal) => {
        if (res.writableEnded || res.destroyed) return;
        sendEvent(
          "exit",
          signal ? `Process terminated by signal ${signal}` : `Process exited with code ${code}`,
        );
        res.end();
      });

      child.on("error", (err) => {
        logger.error({
          message: "[EXECUTE:SSE] Failed",
          error: err,
        });
        if (res.writableEnded || res.destroyed) return;
        sendEvent("error", err.message);
        res.end();
      });
      res.on("close", () => {
        if (!detached && child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
      });
    } catch (error) {
      logger.error({
        message: "[EXECUTE:SSE] Failed",
        error,
      });
      next(
        new APIError({
          code: APIErrorCode.INTERNAL_ERROR,
          message: "Failed to execute command",
          status: 500,
        }),
      );
    }
  };

  public readonly handleRequest = async (
    req: Request,
    res: Response,
    next: NextFunction,
    action?: "execute",
  ): Promise<void> => {
    const { slug } = req.params;
    const { query } = req;
    const resource = this.parser.filters.bySlug(slug);

    if (!resource) {
      next(
        new APIError({
          code: APIErrorCode.NOT_FOUND,
          message: "Resource not found",
          status: 404,
          details: {
            slug,
            query,
          },
        }),
      );
      return;
    }

    const cursor =
      (Array.isArray(query.cursor) ? query.cursor.join("/") : query.cursor?.toString()) || null;
    if (action === "execute") {
      if (!resource.executable) {
        return this.handleExecuteSSERequest(resource, {}, req, res, next);
      }
      let cwd: string | undefined;
      if (cursor) {
        if (resource.type !== "directory") {
          return next(
            new APIError({
              code: APIErrorCode.BAD_REQUEST,
              message: "Execution cursor requires a directory resource",
              status: 400,
            }),
          );
        }
        cwd = await ResourceUtils.resolveDirectoryCursor(resource.target, cursor);
        if (!(await stat(cwd)).isDirectory()) {
          return next(
            new APIError({
              code: APIErrorCode.BAD_REQUEST,
              message: "Execution cursor must be a directory",
              status: 400,
            }),
          );
        }
      }
      return this.handleExecuteSSERequest(resource, { cwd }, req, res, next);
    }

    const currentLocation =
      resource.type === "file"
        ? await ResourceHandler.getResourceFile(resource, { cursor })
        : await ResourceUtils.resolveDirectoryCursor(resource.target, cursor);

    if (req.method === "GET" || req.method === "HEAD") {
      return await this.handleGetRequest(
        resource,
        {
          currentLocation,
          recursive: query.recursive === "true",
          type: ResourceUtils.resolveResponseType(query.type?.toString(), "stream"),
        },
        req,
        res,
      );
    }

    if (req.method === "POST") {
      return await this.handlePostRequest(
        resource,
        {
          currentLocation,
          encoding: ResourceUtils.resolveEncoding(query.encoding?.toString(), "utf-8"),
        },
        req,
        res,
        next,
      );
    }

    if (req.method === "DELETE") {
      return await this.handleDeleteRequest(
        resource,
        {
          currentLocation,
          force: query.force === "true",
        },
        req,
        res,
        next,
      );
    }

    next(
      new APIError({
        code: APIErrorCode.METHOD_NOT_ALLOWED,
        message: "Method not allowed",
        status: 405,
        details: {
          slug,
          query,
        },
      }),
    );
  };
}

export default ResourceHandler;
