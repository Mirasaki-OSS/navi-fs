import path from "node:path";
import { logger } from "../logger";
import appConfig, { validateConfig } from "./config";
import { ResourceUtils } from "./utils";

const _resources = appConfig.resources ?? [];

type ResourceType = "file" | "directory";
type ParsedResource = (typeof _resources)[number] & {
  type: ResourceType;
};

class ResourceFilters {
  constructor(private readonly resources: ParsedResource[]) {}

  readonly bySlug = (slug: string | undefined) => {
    if (!slug) {
      return undefined;
    }

    return this.resources.find((resource) => resource.slug === slug);
  };

  readonly byTarget = (target: string) => {
    return this.resources.find((resource) => resource.target === target);
  };
}

class ResourceValidator {
  constructor(private readonly resources: ParsedResource[]) {}

  private readonly validate = async (resource: ParsedResource) => {
    const { slug, target, extensions } = resource;

    if (!slug || slug.length === 0) {
      throw new Error(`Resource "${target}" has an invalid slug`);
    }

    if (!target || target.length === 0) {
      throw new Error(`Resource "${slug}" has an invalid target`);
    }

    const isDirectory = await ResourceUtils.isDirectory(target);

    logger.debug({
      message: `Resource "${slug}" data: ${target}`,
      type: isDirectory ? "directory" : "file",
      slug,
      target,
      extensions,
    });

    let fileOrFilesExists = true;

    if (isDirectory) {
      if (extensions === null || extensions.length === 0) {
        const hasFiles = await ResourceUtils.hasFiles(target, true);
        if (!hasFiles) {
          logger.warn(`Resource "${slug}" has no files in the target directory: ${target}`);
          fileOrFilesExists = false;
        }
      } else {
        const hasFiles = await ResourceUtils.hasFiles(target, true, extensions);
        if (!hasFiles) {
          logger.warn(`Resource "${slug}" has no files with the specified extensions`);
          fileOrFilesExists = false;
        }
      }
    } else {
      const fileName = path.basename(target);
      const fileExtension = path.extname(fileName) || null;
      const fileNameWithoutExtension = fileExtension
        ? path.basename(fileName, fileExtension)
        : fileName;
      const fileNameHasExtension = fileNameWithoutExtension !== fileName;

      logger.debug({
        message: `Resource "${slug}" file data`,
        fileName,
        fileNameWithoutExtension,
        fileNameHasExtension,
        fileExtension,
      });

      if (fileNameHasExtension && !(await ResourceUtils.checkFileExists(target))) {
        logger.warn(`Resource "${slug}" file does not exist: ${target}`);
        fileOrFilesExists = false;
      } else if (!fileNameHasExtension) {
        if (extensions === null || extensions.length === 0) {
          if (!(await ResourceUtils.hasFiles(target, true))) {
            logger.warn(`Resource "${slug}" has no files in the target directory: ${target}`);
            fileOrFilesExists = false;
          }
        } else {
          const anyExists = await Promise.all(
            extensions.map((extension) =>
              ResourceUtils.checkFileExists(
                path.join(path.dirname(target), `${fileNameWithoutExtension}.${extension}`),
              ),
            ),
          ).then((results) => results.some((exists) => exists));

          if (!anyExists) {
            logger.warn(`Resource "${slug}" has no file with the specified extensions`);
            fileOrFilesExists = false;
          }
        }
      }
    }

    if (fileOrFilesExists) {
      logger.info({
        message: `Resource "${slug}" exists and is valid`,
        slug,
        target,
        type: isDirectory ? "directory" : "file",
        path: target,
      });
    }
  };

  public readonly validateAll = () => {
    const uniqueSlugs = new Set<string>(this.resources.map((resource) => resource.slug));

    if (uniqueSlugs.size !== this.resources.length) {
      throw new Error("Duplicate slugs found in resources");
    }

    for (const resource of this.resources) {
      this.validate(resource);
    }
  };
}

class ResourceParser {
  private constructor(public readonly resources: ParsedResource[]) {
    validateConfig();
    this.validator.validateAll();
  }

  private static instance: ResourceParser;
  public static async getInstance() {
    if (!ResourceParser.instance) {
      ResourceParser.instance = new ResourceParser(await ResourceParser.parse(_resources));
    }
    return ResourceParser.instance;
  }

  private static readonly parse = (resources: typeof _resources): Promise<ParsedResource[]> => {
    return Promise.all(
      resources.map(async (resource) => {
        const { target, ...rest } = resource;

        const isAbsolutePath = path.isAbsolute(target);
        if (!isAbsolutePath) {
          throw new Error(`Resource "${resource.slug}" has an invalid target path: ${target}`);
        }

        return {
          ...rest,
          target: path.normalize(target),
          type: (await ResourceUtils.isDirectory(target)) ? "directory" : "file",
        };
      }),
    );
  };

  readonly filters = new ResourceFilters(this.resources);
  readonly validator = new ResourceValidator(this.resources);
  readonly slugs = this.resources.map((resource) => resource.slug);
  readonly targets = this.resources.map((resource) => resource.target);
}

export { type ParsedResource, ResourceParser };
