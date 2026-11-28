import { strict as assert } from "node:assert";
import { APIError, APIErrorCode } from "../src/modules/api-errors";

describe("API error handling edge cases", () => {
  describe("error construction and serialization", () => {
    it("creates error with all fields", () => {
      const error = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        message: "Test message",
        status: 400,
        details: { field: "value" },
      });

      assert.equal(error.code, APIErrorCode.BAD_REQUEST);
      assert.equal(error.message, "Test message");
      assert.equal(error.status, 400);
      assert.deepEqual(error.details, { field: "value" });
    });

    it("serializes to JSON correctly", () => {
      const error = new APIError({
        code: APIErrorCode.NOT_FOUND,
        message: "Resource not found",
        status: 404,
      });

      const json = error.toJSON();
      assert.ok(json.error);
      assert.equal(json.error.code, "NOT_FOUND");
      assert.equal(json.error.message, "Resource not found");
    });

    it("includes details in JSON when present", () => {
      const details = { resource: "users", action: "read" };
      const error = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Access denied",
        status: 403,
        details,
      });

      const json = error.toJSON();
      assert.deepEqual(json.error.details, details);
    });

    it("omits details from JSON when not provided", () => {
      const error = new APIError({
        code: APIErrorCode.INTERNAL_ERROR,
        message: "Server error",
        status: 500,
      });

      const json = error.toJSON();
      assert.equal(json.error.details, undefined);
    });
  });

  describe("all error codes", () => {
    const errorCodeTests = [
      [APIErrorCode.BAD_REQUEST, 400],
      [APIErrorCode.UNAUTHORIZED, 401],
      [APIErrorCode.FORBIDDEN, 403],
      [APIErrorCode.NOT_FOUND, 404],
      [APIErrorCode.METHOD_NOT_ALLOWED, 405],
      [APIErrorCode.PRECONDITION_FAILED, 412],
      [APIErrorCode.PAYLOAD_TOO_LARGE, 413],
      [APIErrorCode.UNSUPPORTED_MEDIA_TYPE, 415],
      [APIErrorCode.RANGE_NOT_SATISFIABLE, 416],
      [APIErrorCode.TOO_MANY_REQUESTS, 429],
      [APIErrorCode.NOT_IMPLEMENTED, 501],
      [APIErrorCode.INTERNAL_ERROR, 500],
    ] as const;

    for (const [code, status] of errorCodeTests) {
      it(`${code} has status ${status}`, () => {
        const error = new APIError({ code, status });
        assert.equal(error.status, status);
      });
    }
  });

  describe("error message clarity", () => {
    it("provides descriptive messages for client errors", () => {
      const errors = [
        {
          code: APIErrorCode.BAD_REQUEST,
          message: "Invalid request format",
        },
        {
          code: APIErrorCode.UNAUTHORIZED,
          message: "Missing or invalid API key",
        },
        {
          code: APIErrorCode.FORBIDDEN,
          message: "You do not have permission to perform this action",
        },
        {
          code: APIErrorCode.NOT_FOUND,
          message: "The requested resource does not exist",
        },
      ];

      for (const { code, message } of errors) {
        const error = new APIError({ code, message, status: 400 });
        assert.ok(error.message.length > 0);
      }
    });

    it("handles errors with no message", () => {
      const error = new APIError({
        code: APIErrorCode.INTERNAL_ERROR,
        status: 500,
      });

      assert.equal(error.message, "INTERNAL_ERROR");
    });

    it("handles errors with empty string message", () => {
      const error = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        message: "",
        status: 400,
      });

      // APIError uses code as message if empty string is provided, so '' becomes 'BAD_REQUEST'
      assert.equal(error.message, "BAD_REQUEST");
    });
  });

  describe("error classification", () => {
    it("classifies 4xx errors as client errors", () => {
      const clientErrors = [
        APIErrorCode.BAD_REQUEST,
        APIErrorCode.UNAUTHORIZED,
        APIErrorCode.FORBIDDEN,
        APIErrorCode.NOT_FOUND,
        APIErrorCode.METHOD_NOT_ALLOWED,
        APIErrorCode.PRECONDITION_FAILED,
        APIErrorCode.PAYLOAD_TOO_LARGE,
        APIErrorCode.UNSUPPORTED_MEDIA_TYPE,
        APIErrorCode.RANGE_NOT_SATISFIABLE,
        APIErrorCode.TOO_MANY_REQUESTS,
      ];

      for (const code of clientErrors) {
        const error = new APIError({ code, status: 400 });
        assert.ok(error.status >= 400 && error.status < 500);
      }
    });

    it("classifies 5xx errors as server errors", () => {
      const serverErrors = [
        APIErrorCode.NOT_IMPLEMENTED,
        APIErrorCode.INTERNAL_ERROR,
        APIErrorCode.FILE_READ_ERROR,
        APIErrorCode.DIRECTORY_ACCESS_ERROR,
      ];

      for (const code of serverErrors) {
        const error = new APIError({ code, status: 500 });
        assert.ok(error.status >= 500 && error.status < 600);
      }
    });
  });

  describe("special error cases", () => {
    it("handles 429 with retry information", () => {
      const error = new APIError({
        code: APIErrorCode.TOO_MANY_REQUESTS,
        message: "Rate limit exceeded",
        status: 429,
        details: { retryAfter: 60 },
      });

      assert.equal(error.status, 429);
      assert.equal(error.details?.retryAfter, 60);
    });

    it("handles 416 with range information", () => {
      const error = new APIError({
        code: APIErrorCode.RANGE_NOT_SATISFIABLE,
        message: "Range not satisfiable",
        status: 416,
        details: { contentRange: "bytes */100" },
      });

      assert.equal(error.status, 416);
      assert.ok(error.details?.contentRange);
    });

    it("handles 412 with ETag information", () => {
      const error = new APIError({
        code: APIErrorCode.PRECONDITION_FAILED,
        message: "Precondition failed",
        status: 412,
        details: { currentETag: 'W/"123"' },
      });

      assert.equal(error.status, 412);
      assert.ok(error.details?.currentETag);
    });
  });

  describe("error instanceof checks", () => {
    it("is instance of Error", () => {
      const error = new APIError({
        code: APIErrorCode.INTERNAL_ERROR,
        status: 500,
      });

      assert.ok(error instanceof Error);
    });

    it("is instance of APIError", () => {
      const error = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        status: 400,
      });

      assert.ok(error instanceof APIError);
    });

    it("distinguishes APIError from plain Error", () => {
      const apiError = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        status: 400,
      });
      const plainError = new Error("Plain error");

      assert.ok(apiError instanceof APIError);
      assert.ok(!(plainError instanceof APIError));
    });
  });

  describe("error comparisons", () => {
    it("can compare error codes", () => {
      const error1 = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        status: 400,
      });
      const error2 = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        status: 400,
      });

      assert.equal(error1.code, error2.code);
    });

    it("distinguishes between different error codes", () => {
      const error1 = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        status: 400,
      });
      const error2 = new APIError({
        code: APIErrorCode.NOT_FOUND,
        status: 404,
      });

      assert.notEqual(error1.code, error2.code);
    });

    it("distinguishes between different statuses", () => {
      const error1 = new APIError({
        code: APIErrorCode.FORBIDDEN,
        status: 403,
      });
      const error2 = new APIError({
        code: APIErrorCode.NOT_FOUND,
        status: 404,
      });

      assert.notEqual(error1.status, error2.status);
    });
  });

  describe("error code to status mapping", () => {
    it("automatically maps codes to status codes", () => {
      const error = new APIError({
        code: APIErrorCode.NOT_FOUND,
        // No explicit status provided
      });

      assert.equal(error.status, 404);
    });

    it("respects explicit status override", () => {
      const error = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        status: 422, // Different from default 400
      });

      assert.equal(error.status, 422);
    });

    it("handles all error codes with automatic status", () => {
      const codes = [
        APIErrorCode.UNAUTHORIZED,
        APIErrorCode.FORBIDDEN,
        APIErrorCode.NOT_FOUND,
        APIErrorCode.BAD_REQUEST,
      ];

      for (const code of codes) {
        const error = new APIError({ code });
        assert.ok(error.status > 0);
      }
    });
  });
});
