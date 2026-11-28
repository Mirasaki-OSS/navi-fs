/** biome-ignore-all lint/complexity/noUselessSwitchCase: We prefer explicit fall-through here */
export enum APIErrorCode {
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  NOT_FOUND = "NOT_FOUND",
  METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED",
  BAD_REQUEST = "BAD_REQUEST",
  PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE = "UNSUPPORTED_MEDIA_TYPE",
  PRECONDITION_FAILED = "PRECONDITION_FAILED",
  RANGE_NOT_SATISFIABLE = "RANGE_NOT_SATISFIABLE",
  TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS",
  FILE_READ_ERROR = "FILE_READ_ERROR",
  DIRECTORY_ACCESS_ERROR = "DIRECTORY_ACCESS_ERROR",
  UNSUPPORTED_RESPONSE_TYPE = "UNSUPPORTED_RESPONSE_TYPE",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  NOT_IMPLEMENTED = "NOT_IMPLEMENTED",
}

interface APIErrorOptions {
  code: APIErrorCode;
  message?: string;
  status?: number;
  details?: Record<string, unknown>;
}

export class APIError extends Error {
  public readonly code: APIErrorCode;
  public readonly status: number;
  public readonly details: Record<string, unknown> | undefined;

  constructor({ code, message, status, details }: APIErrorOptions) {
    super(message || code);
    this.name = "APIError";
    this.code = code;
    this.status = status ?? APIError.mapCodeToStatus(code);
    this.details = details;

    Object.setPrototypeOf(this, APIError.prototype);
  }

  static mapCodeToStatus(code: APIErrorCode): number {
    switch (code) {
      case APIErrorCode.UNAUTHORIZED:
        return 401;
      case APIErrorCode.FORBIDDEN:
        return 403;
      case APIErrorCode.NOT_FOUND:
        return 404;
      case APIErrorCode.METHOD_NOT_ALLOWED:
        return 405;
      case APIErrorCode.BAD_REQUEST:
        return 400;
      case APIErrorCode.PAYLOAD_TOO_LARGE:
        return 413;
      case APIErrorCode.UNSUPPORTED_MEDIA_TYPE:
        return 415;
      case APIErrorCode.PRECONDITION_FAILED:
        return 412;
      case APIErrorCode.RANGE_NOT_SATISFIABLE:
        return 416;
      case APIErrorCode.TOO_MANY_REQUESTS:
        return 429;
      case APIErrorCode.UNSUPPORTED_RESPONSE_TYPE:
        return 400;
      case APIErrorCode.NOT_IMPLEMENTED:
        return 501;

      case APIErrorCode.FILE_READ_ERROR:
      case APIErrorCode.DIRECTORY_ACCESS_ERROR:
      default:
        return 500;
    }
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
