import { constants } from "node:fs";
import { access, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../logger";
import { APIError, APIErrorCode } from "../modules/api-errors";
import { type ResponseType, responseTypes, type SizePolicy } from "./schema";

interface ResourceMeta {
  filePath: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  lastModified?: Date;
  createdAt?: Date;
  mimeType?: string;
  encoding?: string;
  [key: string]: unknown;
}

class ResourceUtils {
  private static isContained(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  }

  static async resolveDirectoryCursor(root: string, cursor: string | null): Promise<string> {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, cursor ?? "");
    const forbidden = () =>
      new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Cursor is outside the resource",
        status: 403,
      });

    if ((cursor && path.isAbsolute(cursor)) || !ResourceUtils.isContained(resolvedRoot, target)) {
      throw forbidden();
    }

    const [realRoot, realTarget] = await Promise.all([realpath(resolvedRoot), realpath(target)]);
    if (!ResourceUtils.isContained(realRoot, realTarget)) {
      throw forbidden();
    }

    return target;
  }

  /**
   * Check if a file exists at the given path. Note that this should not be used when
   * trying to serve a resource, as quoted by the native Node.js documentation:
   *
   * "Using `fsPromises.access()` to check for the accessibility of a file before calling `fsPromises.open()` is not recommended.
   * Doing so introduces a race condition, since other processes may change the file's state between the two calls.
   * Instead, user code should open/read/write the file directly and handle the error raised if the file is not accessible."
   */
  static async checkFileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        logger.debug({
          message: `File does not exist: ${filePath}`,
          error,
        });
        return false;
      }
      throw error;
    }
  }

  static resolveResponseType(input?: string, defaultType: ResponseType = "stream"): ResponseType {
    if (responseTypes.includes(input as ResponseType)) {
      return input as ResponseType;
    }

    const mimeType = input ? ResourceUtils.getMimeType(input) : null;

    if (mimeType) {
      const mimeToResponseType: Record<string, ResponseType> = {
        "text/plain": "text",
        "application/json": "json",
        "application/xml": "xml",
        "text/html": "html",
        "text/csv": "csv",
        "application/x-yaml": "yaml",
        "application/toml": "toml",
      };
      return mimeToResponseType[mimeType] ?? defaultType;
    }

    const ext = input ? ResourceUtils.getFileExtension(input) : null;

    if (ext && responseTypes.includes(ext as ResponseType)) {
      return ext as ResponseType;
    }

    return defaultType;
  }

  /**
   * Get the file extension of a file.
   */
  static getFileExtension(filePath: string): string {
    const ext = path.extname(filePath);
    return ext ? ext.slice(1) : "";
  }

  /**
   * Get the MIME type of a file based on its extension.
   * If the extension is not recognized, return null.
   *
   * Please note this only includes MIME types for our supported
   * (response) formats.
   *
   * Handles both filenames (e.g., 'file.txt') and bare extensions (e.g., 'txt')
   */
  static getMimeType(filePath: string): string | null {
    let ext = ResourceUtils.getFileExtension(filePath).toLowerCase();

    if (!ext) {
      ext = filePath.toLowerCase();
    }

    const mimeTypes: Record<string, string> = {
      txt: "text/plain",
      json: "application/json",
      xml: "application/xml",
      html: "text/html",
      csv: "text/csv",
      yaml: "application/x-yaml",
      toml: "application/toml",
    };
    return mimeTypes[ext] || null;
  }

  /**
   * Check if a directory exists at the given path.
   */
  static async isDirectory(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      return stats.isDirectory();
    } catch (error) {
      logger.debug({
        message: `Path is not a directory: ${filePath}`,
        error,
      });
      return false;
    }
  }

  /**
   * Check if a directory contains files with the specified extensions.
   * - If `recursive` is true, it will check all subdirectories as well.
   * - If `extensionWhitelist` is empty, it will return true if any files are found.
   */
  static async hasFiles(
    directoryPath: string,
    recursive = false,
    extensionWhitelist: string[] = [],
  ): Promise<boolean> {
    try {
      const entries = await readdir(directoryPath);

      const filteredFiles =
        extensionWhitelist.length > 0
          ? entries.filter((file) => extensionWhitelist.some((ext) => file.endsWith(ext)))
          : entries;

      if (filteredFiles.length > 0) {
        return true;
      }

      if (!recursive) {
        return false;
      }

      const subDirs = filteredFiles.map((entry) => path.join(directoryPath, entry));
      const results = await Promise.all(
        subDirs.map((dir) => ResourceUtils.hasFiles(dir, true, extensionWhitelist)),
      );

      return results.some(Boolean);
    } catch {
      return false;
    }
  }

  /**
   * List all files in a directory with the specified extensions.
   * - If `recursive` is true, it will list all files in subdirectories as well.
   * - If `extensionWhitelist` is empty, it will list all files.
   */
  static async listFiles(
    directoryPath: string,
    recursive = false,
    extensionWhitelist: string[] = [],
    resourceRoot = directoryPath,
  ): Promise<string[]> {
    const realRoot = await realpath(resourceRoot);
    const list = async (directory: string, ancestors: Set<string>): Promise<string[]> => {
      const realDirectory = await realpath(directory);
      if (!ResourceUtils.isContained(realRoot, realDirectory) || ancestors.has(realDirectory)) {
        return [];
      }

      const nextAncestors = new Set(ancestors).add(realDirectory);
      const entries = await readdir(directory, { withFileTypes: true });
      const results = await Promise.all(
        entries.map(async (entry) => {
          const filePath = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) {
            let realTarget: string;
            try {
              realTarget = await realpath(filePath);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                logger.debug(`Skipping dangling symbolic link: ${filePath}`);
                return [];
              }
              throw error;
            }
            if (!ResourceUtils.isContained(realRoot, realTarget)) {
              return [];
            }
          }

          const isDir =
            entry.isDirectory() || (entry.isSymbolicLink() && (await stat(filePath)).isDirectory());

          if (isDir && recursive) {
            return await list(filePath, nextAncestors);
          }

          if (isDir) {
            return [filePath];
          }

          if (
            extensionWhitelist.length > 0 &&
            !extensionWhitelist.some((ext) => filePath.endsWith(ext))
          ) {
            return [];
          }

          return [filePath];
        }),
      );

      return results.flat();
    };

    return list(directoryPath, new Set());
  }

  static async readFile(filePath: string): Promise<{ data: string; meta: ResourceMeta }> {
    try {
      const [data, stats] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);

      return {
        data,
        meta: {
          filePath,
          fileName: path.basename(filePath),
          fileSize: stats.size,
          fileType: ResourceUtils.getFileExtension(filePath),
          lastModified: stats.mtime,
          createdAt: stats.birthtime,
          mimeType: "application/octet-stream", // Default MIME type, can be improved
          encoding: "utf-8", // Default encoding, can be improved
        },
      };
    } catch (error) {
      logger.debug({
        message: `Error reading file: ${filePath}`,
        error,
      });
      throw error;
    }
  }

  /**
   * Check if a file matches a size policy's extension filter.
   */
  private static matchesPolicyExtensions(filePath: string, policy: SizePolicy): boolean {
    if (!policy.extensions || policy.extensions.length === 0) {
      return true;
    }
    return policy.extensions.some((ext) => filePath.endsWith(ext));
  }

  /**
   * Check if a file matches a size policy's pattern filter.
   */
  private static matchesPolicyPattern(filePath: string, policy: SizePolicy): boolean {
    if (!policy.pattern) {
      return true;
    }
    try {
      const regex = new RegExp(policy.pattern);
      return regex.test(filePath);
    } catch {
      logger.warn(`Invalid regex pattern in size policy: ${policy.pattern}`);
      return true;
    }
  }

  /**
   * Apply size policies to file content.
   * Returns the processed content and whether it was truncated.
   */
  static applySizePolicy(
    content: string,
    filePath: string,
    policies: SizePolicy | SizePolicy[] | null,
  ): { data: string; truncated: boolean };
  static applySizePolicy(
    content: string[],
    filePath: string | null,
    policies: SizePolicy | SizePolicy[] | null,
  ): { data: string[]; truncated: boolean };
  static applySizePolicy(
    content: string | string[],
    filePath: string | null,
    policies: SizePolicy | SizePolicy[] | null,
  ): { data: string | string[]; truncated: boolean } {
    if (!policies) {
      return { data: content, truncated: false };
    }

    if (Array.isArray(content)) {
      return ResourceUtils.applySizePolicyToFileList(content, policies);
    }

    const policyList = Array.isArray(policies) ? policies : [policies];
    let currentContent = content as string;
    let cumulativeSize = 0;
    let truncated = false;

    for (const policy of policyList) {
      if (
        !ResourceUtils.matchesPolicyExtensions(filePath ?? "", policy) ||
        !ResourceUtils.matchesPolicyPattern(filePath ?? "", policy)
      ) {
        continue;
      }

      if (policy.unit === "bytes") {
        const size = policy.cumulative
          ? cumulativeSize + currentContent.length
          : currentContent.length;
        if (size > policy.limit) {
          if (policy.mode === "reject") {
            return { data: "", truncated: true };
          }
          if (policy.mode === "warn") {
            logger.warn(
              `File ${filePath} exceeds size limit of ${policy.limit} bytes (actual: ${size})`,
            );
            return { data: currentContent, truncated: false };
          }
          if (policy.mode === "truncate") {
            currentContent = currentContent.substring(0, policy.limit);
            truncated = true;
          }
        }
        cumulativeSize += currentContent.length;
      } else if (policy.unit === "lines") {
        const lines = currentContent.split("\n");
        if (lines.length > policy.limit) {
          if (policy.mode === "reject") {
            return { data: "", truncated: true };
          }
          if (policy.mode === "warn") {
            logger.warn(
              `File ${filePath} exceeds line limit of ${policy.limit} lines (actual: ${lines.length})`,
            );
            return { data: currentContent, truncated: false };
          }
          if (policy.mode === "truncate") {
            currentContent = lines.slice(0, policy.limit).join("\n");
            truncated = true;
          }
        }
      }
    }

    return { data: currentContent, truncated };
  }

  /**
   * Apply size policies to a directory file listing.
   * Limits the number of files returned based on 'files' unit policies.
   */
  private static applySizePolicyToFileList(
    files: string[],
    policies: SizePolicy | SizePolicy[] | null,
  ): { data: string[]; truncated: boolean } {
    if (!policies) {
      return { data: files, truncated: false };
    }

    const policyList = Array.isArray(policies) ? policies : [policies];
    let currentFiles = files;
    let truncated = false;

    for (const policy of policyList) {
      if (policy.unit !== "files") {
        continue;
      }

      if (currentFiles.length > policy.limit) {
        if (policy.mode === "reject") {
          return { data: [], truncated: true };
        }
        if (policy.mode === "warn") {
          logger.warn(
            `Directory listing exceeds file limit of ${policy.limit} files (actual: ${currentFiles.length})`,
          );
          return { data: currentFiles, truncated: false };
        }
        if (policy.mode === "truncate") {
          currentFiles = currentFiles.slice(0, policy.limit);
          truncated = true;
        }
      }
    }

    return { data: currentFiles, truncated };
  }

  static readonly resolveEncoding = (
    encoding: unknown,
    defaultValue: BufferEncoding = "utf-8",
  ): BufferEncoding => {
    if (encoding === null || encoding === undefined || typeof encoding !== "string") {
      return defaultValue;
    }

    const validEncodings: BufferEncoding[] = [
      "utf-8",
      "ascii",
      "utf8",
      "utf16le",
      "utf-16le",
      "ucs2",
      "ucs-2",
      "base64",
      "base64url",
      "latin1",
      "binary",
      "hex",
    ];

    if (validEncodings.includes(encoding as BufferEncoding)) {
      return encoding as BufferEncoding;
    }

    return defaultValue;
  };

  static async writeFile(
    filePath: string,
    data: string,
    options: { encoding?: BufferEncoding | null | undefined } = {},
  ): Promise<void> {
    try {
      const { encoding = "utf-8" } = options;
      await writeFile(filePath, data, { encoding });
    } catch (error) {
      logger.debug({
        message: `Error writing file: ${filePath}`,
        error,
      });
      throw error;
    }
  }

  static async deleteTarget(filePath: string, type: "file" | "directory"): Promise<void> {
    try {
      await rm(filePath, { force: true, recursive: type === "directory" });
    } catch (error) {
      logger.debug({
        message: `Error deleting file: ${filePath}`,
        error,
      });
      throw error;
    }
  }
}

export { type ResourceMeta, ResourceUtils };
