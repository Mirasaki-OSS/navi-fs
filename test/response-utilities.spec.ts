import { strict as assert } from "node:assert";
import type { Response } from "express";
import { APIError, APIErrorCode } from "../src/modules/api-errors";
import { typedResponse } from "../src/response";

describe("Response utilities", () => {
  describe("typedResponse", () => {
    it("returns APIError with error status code", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const error = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        message: "Invalid request",
        status: 400,
      });

      typedResponse(mockRes as unknown as Response, error);

      assert.equal(mockRes.statusCode, 400);
      assert.ok(mockRes.jsonData);
      assert.equal((mockRes.jsonData as { error: { code: string } }).error.code, "BAD_REQUEST");
    });

    it("returns success data with 200 status by default", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const data = { data: { message: "Success" } };
      typedResponse(mockRes as unknown as Response, data);

      assert.equal(mockRes.statusCode, 200);
      assert.deepEqual(mockRes.jsonData, data);
    });

    it("respects custom status code for success responses", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const data = { data: { message: "Created" } };
      typedResponse(mockRes as unknown as Response, data, 201);

      assert.equal(mockRes.statusCode, 201);
      assert.deepEqual(mockRes.jsonData, data);
    });

    it("handles error responses with custom status override", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const error = new APIError({
        code: APIErrorCode.BAD_REQUEST,
        message: "Invalid request",
        status: 400,
      });

      typedResponse(mockRes as unknown as Response, error, 422);

      // Should use the override status
      assert.equal(mockRes.statusCode, 422);
    });

    it("handles 404 responses", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const error = new APIError({
        code: APIErrorCode.NOT_FOUND,
        message: "Resource not found",
        status: 404,
      });

      typedResponse(mockRes as unknown as Response, error);

      assert.equal(mockRes.statusCode, 404);
      assert.equal(
        (mockRes.jsonData as unknown as { error: { code: string } }).error.code,
        "NOT_FOUND",
      );
    });

    it("handles 500 error responses", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const error = new APIError({
        code: APIErrorCode.INTERNAL_ERROR,
        message: "Internal server error",
        status: 500,
      });

      typedResponse(mockRes as unknown as Response, error);

      assert.equal(mockRes.statusCode, 500);
    });

    it("returns the response object for chaining", () => {
      const mockRes = {
        status: function (code: number) {
          this.statusCode = code;
          return this;
        },
        json: function (data: unknown) {
          this.jsonData = data;
          return this;
        },
        statusCode: 0,
        jsonData: null as unknown,
      };

      const result = typedResponse(mockRes as unknown as Response, { data: { test: true } });

      assert.equal(result, mockRes);
    });
  });
});
