import { createReadStream } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { APIError, APIErrorCode } from '../modules/api-errors';

const DEFAULT_SEARCH_LIMIT = 100;
const MAX_SEARCH_LIMIT = 500;
const MAX_SEARCH_OFFSET = 10_000;
const MAX_SEARCH_FILES = 10_000;
const MAX_SEARCH_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SEARCH_BYTES = 50 * 1024 * 1024;
const MAX_SEARCH_QUERY_LENGTH = 256;

const badSearchRequest = (message: string): APIError =>
  new APIError({ code: APIErrorCode.BAD_REQUEST, message, status: 400 });

const getSearchQueryString = (value: unknown, name: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw badSearchRequest(`"${name}" must be specified once as a string`);
  }
  return value;
};

const parseSearchInteger = (value: unknown, name: string): number | undefined => {
  const raw = getSearchQueryString(value, name);
  if (raw === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw badSearchRequest(`"${name}" must be a non-negative integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw badSearchRequest(`"${name}" is too large`);
  }
  return parsed;
};

const parseSearchDate = (value: unknown, name: string): number | undefined => {
  const raw = getSearchQueryString(value, name);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw badSearchRequest(`"${name}" must be a valid date`);
  }
  return parsed;
};

const parseSearchExtensions = (value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }
  const values: unknown[] = Array.isArray(value) ? value : [value];
  if (
    !values.every(
      (extension): extension is string =>
        typeof extension === "string" && /^\.[^/\\\s]+$/.test(extension),
    )
  ) {
    throw badSearchRequest('"extension" must be one or more suffixes such as ".txt"');
  }
  return values.map((extension) => extension.toLowerCase());
};

const searchFileContents = async (
  filePath: string,
  query: string,
  fileSize: number,
  byteLimit: number,
): Promise<{ matches: boolean; bytesRead: number; truncated: boolean }> => {
  const readLimit = Math.min(fileSize, MAX_SEARCH_FILE_BYTES, byteLimit);
  if (readLimit === 0) {
    return { matches: false, bytesRead: 0, truncated: fileSize > 0 };
  }

  const decoder = new StringDecoder("utf8");
  const queryLower = query.toLowerCase();
  let carry = "";
  let matches = false;
  let isBinary = false;
  let bytesRead = 0;
  const stream = createReadStream(filePath, { end: readLimit - 1 });

  for await (const chunk of stream) {
    bytesRead += chunk.byteLength;
    if (chunk.includes(0)) {
      isBinary = true;
      break;
    }

    const text = decoder.write(chunk);
    const combined = carry + text;
    if (combined.toLowerCase().includes(queryLower)) {
      matches = true;
    }
    carry = combined.slice(-queryLower.length);
  }

  if (!isBinary) {
    const tail = decoder.end();
    if ((carry + tail).toLowerCase().includes(queryLower)) {
      matches = true;
    }
  }

  return {
    matches: !isBinary && matches,
    bytesRead,
    truncated: fileSize > readLimit,
  };
};

export {
  badSearchRequest,
  DEFAULT_SEARCH_LIMIT,
  getSearchQueryString,
  MAX_SEARCH_BYTES,
  MAX_SEARCH_FILE_BYTES,
  MAX_SEARCH_FILES,
  MAX_SEARCH_LIMIT,
  MAX_SEARCH_OFFSET,
  MAX_SEARCH_QUERY_LENGTH,
  parseSearchDate,
  parseSearchExtensions,
  parseSearchInteger,
  searchFileContents,
}