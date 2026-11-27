import { strict as assert } from "node:assert";
import { APIError, APIErrorCode } from "../src/modules/api-errors";

describe("API errors", () => {
  it("uses the appropriate default HTTP status for client errors", () => {
    for (const [code, status] of [
      [APIErrorCode.BAD_REQUEST, 400],
      [APIErrorCode.METHOD_NOT_ALLOWED, 405],
      [APIErrorCode.PRECONDITION_FAILED, 412],
      [APIErrorCode.PAYLOAD_TOO_LARGE, 413],
      [APIErrorCode.UNSUPPORTED_MEDIA_TYPE, 415],
      [APIErrorCode.RANGE_NOT_SATISFIABLE, 416],
      [APIErrorCode.TOO_MANY_REQUESTS, 429],
      [APIErrorCode.NOT_IMPLEMENTED, 501],
    ] as const) {
      assert.equal(new APIError({ code }).status, status, code);
    }
  });
});
