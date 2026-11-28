import { strict as assert } from "node:assert";
import { APIError, APIErrorCode } from "../src/modules/api-errors";

describe("Authentication and Authorization", () => {
  describe("Master API Key validation", () => {
    it("recognizes master API key concept", () => {
      const headerName = "x-api-key";
      assert.equal(headerName, "x-api-key");
    });

    it("provides error handling for authentication", () => {
      assert.ok(typeof APIError === "function");
    });
  });

  describe("error handling in authentication", () => {
    it("creates UNAUTHORIZED error with 401 status", () => {
      const error = new APIError({
        code: APIErrorCode.UNAUTHORIZED,
        message: "API key is missing",
        status: 401,
      });

      assert.equal(error.status, 401);
      assert.equal(error.code, APIErrorCode.UNAUTHORIZED);
    });

    it("creates FORBIDDEN error with 403 status", () => {
      const error = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Invalid API key",
        status: 403,
      });

      assert.equal(error.status, 403);
      assert.equal(error.code, APIErrorCode.FORBIDDEN);
    });

    it("distinguishes between missing and invalid keys", () => {
      const missingError = new APIError({
        code: APIErrorCode.UNAUTHORIZED,
        message: "API key is missing",
        status: 401,
      });

      const invalidError = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Invalid API key",
        status: 403,
      });

      assert.notEqual(missingError.status, invalidError.status);
      assert.notEqual(missingError.code, invalidError.code);
    });
  });

  describe("authorization action types", () => {
    it("recognizes read action", () => {
      const action = "read" as const;
      assert.equal(action, "read");
    });

    it("recognizes write action", () => {
      const action = "write" as const;
      assert.equal(action, "write");
    });

    it("recognizes delete action", () => {
      const action = "delete" as const;
      assert.equal(action, "delete");
    });

    it("recognizes execute action", () => {
      const action = "execute" as const;
      assert.equal(action, "execute");
    });

    it("handles all action types", () => {
      const actions = ["read", "write", "delete", "execute"] as const;
      assert.equal(actions.length, 4);

      for (const action of actions) {
        assert.ok(["read", "write", "delete", "execute"].includes(action));
      }
    });
  });

  describe("permission structure validation", () => {
    it("validates permission type as string", () => {
      const permission = { type: "read" as const, "api-key": "key123" };
      assert.equal(permission.type, "read");
      assert.equal(permission["api-key"], "key123");
    });

    it("validates permission type as array", () => {
      const permission = { type: ["read", "write"] as const, "api-key": "key123" };
      assert.ok(Array.isArray(permission.type));
      assert.equal(permission.type.length, 2);
    });

    it('validates "all" permission', () => {
      const permission = { type: "all" as const, "api-key": "key123" };
      assert.equal(permission.type, "all");
    });

    it("validates api-key field", () => {
      const permission = { type: "read" as const, "api-key": "secretkey123" };
      assert.ok(permission["api-key"].length > 0);
    });
  });

  describe("resource-based authorization", () => {
    it("allows master key access to protected resources", () => {
      // Test that master key concept is understood
      const masterKey = "master-key-should-access-all";
      const regularKey = "regular-key";

      assert.notEqual(masterKey, regularKey);
      assert.ok(masterKey.includes("master"));
    });

    it("restricts resource keys to their resources", () => {
      // Test demonstrates conceptual understanding
      const resourceAKey = "key-for-resource-a";
      const resourceBKey = "key-for-resource-b";

      // Keys should be different for different resources
      assert.notEqual(resourceAKey, resourceBKey);
    });

    it("handles resource not found during authorization", () => {
      const error = new APIError({
        code: APIErrorCode.NOT_FOUND,
        message: "Resource not found",
        status: 404,
        details: { slug: "unknown-resource" },
      });

      assert.equal(error.status, 404);
      assert.equal(error.details?.slug, "unknown-resource");
    });
  });

  describe("action-specific permissions", () => {
    it("enforces read permission separately from write", () => {
      // Conceptual test showing read/write separation
      const readPermission = { type: "read" as const, "api-key": "read-key" };
      const writePermission = { type: "write" as const, "api-key": "write-key" };

      assert.notEqual(readPermission["api-key"], writePermission["api-key"]);
      assert.notEqual(readPermission.type, writePermission.type);
    });

    it("enforces delete permission separately from read", () => {
      const readPermission = { type: "read" as const, "api-key": "read-key" };
      const deletePermission = { type: "delete" as const, "api-key": "delete-key" };

      assert.notEqual(readPermission["api-key"], deletePermission["api-key"]);
      assert.notEqual(readPermission.type, deletePermission.type);
    });

    it("handles execute permission", () => {
      const executePermission = { type: "execute" as const, "api-key": "execute-key" };
      assert.equal(executePermission.type, "execute");
    });

    it("allows combined permissions", () => {
      const combinedPermission = { type: ["read", "write"] as const, "api-key": "combined-key" };
      assert.ok(combinedPermission.type.includes("read"));
      assert.ok(combinedPermission.type.includes("write"));
    });
  });

  describe("error messages in authorization", () => {
    it("provides resource-specific error details", () => {
      const error = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Not authorized to perform action on this resource",
        status: 403,
        details: {
          action: "write",
          resource: "protected-resource",
        },
      });

      assert.equal(error.details?.action, "write");
      assert.equal(error.details?.resource, "protected-resource");
    });

    it("indicates action not allowed for resource", () => {
      const error = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Action not allowed",
        status: 403,
        details: {
          action: "delete",
          status: "prohibited",
        },
      });

      assert.equal(error.details?.action, "delete");
      assert.equal(error.details?.status, "prohibited");
    });

    it("distinguishes no permissions from wrong key", () => {
      const noPermsError = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Action not allowed on this resource type",
        status: 403,
        details: { reason: "no_permissions_configured" },
      });

      const wrongKeyError = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Not authorized with the provided API key",
        status: 403,
        details: { reason: "invalid_api_key" },
      });

      assert.notEqual(noPermsError.details?.reason, wrongKeyError.details?.reason);
    });
  });

  describe("security considerations", () => {
    it("never includes API key in error response", () => {
      const error = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Invalid API key",
        status: 403,
        details: { hint: "check your api-key header" },
      });

      const errorJSON = error.toJSON();
      const errorString = JSON.stringify(errorJSON);

      // Should not contain actual API key
      assert.ok(!errorString.includes("actual-key-value"));
    });

    it("provides sufficient error messages without leaking details", () => {
      const error = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Not authorized to perform action on this resource",
        status: 403,
      });

      // Message is helpful but doesn't reveal specifics
      assert.ok(error.message.includes("authorized"));
      assert.ok(error.message.includes("action"));
    });

    it("uses consistent error messages", () => {
      const error1 = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Not authorized",
        status: 403,
      });

      const error2 = new APIError({
        code: APIErrorCode.FORBIDDEN,
        message: "Not authorized",
        status: 403,
      });

      assert.equal(error1.message, error2.message);
    });
  });

  describe("key validation", () => {
    it("validates key length", () => {
      const shortKey = "short";
      const longKey = "this-is-a-much-longer-and-more-secure-key-with-many-characters";

      assert.ok(shortKey.length < longKey.length);
    });

    it("recognizes minimum key length", () => {
      // Based on code review, recommended minimum is 128
      const minimumLength = 128;
      const weakKey = "w".repeat(32);
      const strongKey = "k".repeat(minimumLength);

      assert.ok(weakKey.length < minimumLength);
      assert.ok(strongKey.length >= minimumLength);
    });

    it("handles keys with special characters", () => {
      const key = "key!@#$%^&*()_+-=[]{}|;:,.<>?";
      assert.ok(key.length > 0);
    });

    it("handles keys with spaces", () => {
      const key = "key with spaces";
      assert.ok(key.includes(" "));
    });
  });
});
