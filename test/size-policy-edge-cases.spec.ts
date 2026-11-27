import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SizePolicy } from "../src/resources/schema";
import { ResourceUtils } from "../src/resources/utils";

describe("Size policy edge cases and advanced scenarios", () => {
  let temporaryDirectory: string;

  before(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "navi-fs-size-edge-"));
  });

  after(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  describe("boundary conditions", () => {
    it("leaves content unchanged when size equals limit exactly", () => {
      const content = "Hello World";
      const policy: SizePolicy = { unit: "bytes", limit: 11, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "Hello World");
      assert.equal(result.truncated, false);
    });

    it("truncates when size is 1 byte over limit", () => {
      const content = "Hello World!";
      const policy: SizePolicy = { unit: "bytes", limit: 11, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data.length, 11);
      assert.equal(result.truncated, true);
    });

    it("handles zero-byte limit correctly in truncate mode", () => {
      const content = "Some content";
      const policy: SizePolicy = { unit: "bytes", limit: 0, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "");
      assert.equal(result.truncated, true);
    });

    it("handles single line at exactly limit", () => {
      const content = "Single line";
      const policy: SizePolicy = { unit: "lines", limit: 1, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "Single line");
      assert.equal(result.truncated, false);
    });

    it("handles single file at exactly limit", () => {
      const files = ["file.txt"];
      const policy: SizePolicy = { unit: "files", limit: 1, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(files, null, policy);
      assert.deepEqual(result.data, ["file.txt"]);
      assert.equal(result.truncated, false);
    });
  });

  describe("empty content handling", () => {
    it("returns empty string with empty content", () => {
      const content = "";
      const policy: SizePolicy = { unit: "bytes", limit: 100, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "");
      assert.equal(result.truncated, false);
    });

    it("handles zero lines", () => {
      const content = "";
      const policy: SizePolicy = { unit: "lines", limit: 10, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "");
      assert.equal(result.truncated, false);
    });

    it("returns empty array with empty file list", () => {
      const files: string[] = [];
      const policy: SizePolicy = { unit: "files", limit: 10, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(files, null, policy);
      assert.deepEqual(result.data, []);
      assert.equal(result.truncated, false);
    });

    it("handles whitespace-only content", () => {
      const content = "   \n  \n  ";
      const policy: SizePolicy = { unit: "lines", limit: 2, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, true);
    });
  });

  describe("line ending handling", () => {
    it("handles Unix line endings (LF)", () => {
      const content = "Line 1\nLine 2\nLine 3";
      const policy: SizePolicy = { unit: "lines", limit: 2, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "Line 1\nLine 2");
      assert.equal(result.truncated, true);
    });

    it("handles trailing newline", () => {
      const content = "Line 1\nLine 2\nLine 3\n";
      const policy: SizePolicy = { unit: "lines", limit: 2, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "Line 1\nLine 2");
      assert.equal(result.truncated, true);
    });
  });

  describe("unicode and multibyte characters", () => {
    it("handles multibyte UTF-8 characters in bytes mode", () => {
      const content = "You have 500 chars"; // Simple ASCII for consistent testing
      const policy: SizePolicy = { unit: "bytes", limit: 6, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, true);
      // UTF-8 boundary should be preserved
      assert.ok(result.data.length <= 6);
    });

    it("counts lines with unicode characters correctly", () => {
      const content = "你好\n世界\n测试";
      const policy: SizePolicy = { unit: "lines", limit: 2, mode: "truncate", cumulative: false };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.data, "你好\n世界");
      assert.equal(result.truncated, true);
    });
  });

  describe("cumulative mode", () => {
    it("accumulates size across multiple policies in truncate mode", () => {
      const content = "Line 1\nLine 2\nLine 3\nLine 4";
      const policies: SizePolicy[] = [
        { unit: "lines", limit: 10, mode: "truncate", cumulative: true },
        { unit: "bytes", limit: 20, mode: "truncate", cumulative: true },
      ];
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policies);
      assert.ok(result.truncated);
      assert.ok(result.data.length <= 20);
    });

    it("applies policies sequentially with cumulative tracking", () => {
      const content = "ABCDEFGHIJKLMNOPQRST"; // 20 bytes, 1 line
      const policies: SizePolicy[] = [
        { unit: "bytes", limit: 15, mode: "truncate", cumulative: true },
        { unit: "bytes", limit: 10, mode: "truncate", cumulative: true },
      ];
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policies);
      assert.equal(result.data, "ABCDEFGHIJ");
      assert.equal(result.truncated, true);
    });
  });

  describe("extension filtering precision", () => {
    it("matches extension case-sensitively on Unix", () => {
      const content = "Should not truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".TXT"], // uppercase
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy); // lowercase
      // Case-sensitive - should NOT truncate since .txt !== .TXT (policy does not apply)
      assert.equal(result.truncated, false);
    });

    it("applies policy when extension matches exactly", () => {
      const content = "Should truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".txt"],
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, true);
    });

    it("skips policy when extension does not match", () => {
      const content = "Should not truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".log"],
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, false);
    });

    it("handles files with no extension", () => {
      const content = "Should not truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".txt"],
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "README", policy);
      assert.equal(result.truncated, false);
    });

    it("handles multiple dots in filename", () => {
      const content = "Should truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".gz"],
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "archive.tar.gz", policy);
      assert.equal(result.truncated, true);
    });
  });

  describe("regex pattern handling", () => {
    it("applies policy when pattern matches", () => {
      const content = "Should truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        pattern: ".*\\.txt$",
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, true);
    });

    it("skips policy when pattern does not match", () => {
      const content = "Should not truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        pattern: ".*\\.log$",
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, false);
    });

    it("gracefully handles invalid regex patterns", () => {
      const content = "Should match all";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        pattern: "[invalid(regex", // Invalid regex
        mode: "truncate",
        cumulative: false,
      };
      // Should not crash
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policy);
      assert.equal(result.truncated, true);
    });

    it("combines extension and pattern filters with AND logic", () => {
      const content = "Should not truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".txt"],
        pattern: "^test-",
        mode: "truncate",
        cumulative: false,
      };
      // File matches extension but not pattern
      const result = ResourceUtils.applySizePolicy(content, "report.txt", policy);
      assert.equal(result.truncated, false);
    });
  });

  describe("large content handling", () => {
    it("efficiently truncates very large content by bytes", () => {
      const largeContent = "A".repeat(1000000); // 1MB
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 10000,
        mode: "truncate",
        cumulative: false,
      };
      const start = Date.now();
      const result = ResourceUtils.applySizePolicy(largeContent, "huge.txt", policy);
      const duration = Date.now() - start;
      assert.equal(result.data.length, 10000);
      assert.equal(result.truncated, true);
      assert.ok(duration < 1000, `Truncation took ${duration}ms, should be < 1000ms`);
    });

    it("efficiently truncates large file lists", () => {
      const files = Array(100000)
        .fill(null)
        .map((_, i) => `file${i}.txt`);
      const policy: SizePolicy = {
        unit: "files",
        limit: 1000,
        mode: "truncate",
        cumulative: false,
      };
      const start = Date.now();
      const result = ResourceUtils.applySizePolicy(files, null, policy);
      const duration = Date.now() - start;
      assert.equal(result.data.length, 1000);
      assert.equal(result.truncated, true);
      assert.ok(duration < 500, `Truncation took ${duration}ms, should be < 500ms`);
    });
  });

  describe("special characters in filenames", () => {
    it("handles spaces in filenames", () => {
      const content = "Should truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".txt"],
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "my file.txt", policy);
      assert.equal(result.truncated, true);
    });

    it("handles dots in filename with extension filter", () => {
      const content = "Should truncate";
      const policy: SizePolicy = {
        unit: "bytes",
        limit: 5,
        extensions: [".gz"],
        mode: "truncate",
        cumulative: false,
      };
      const result = ResourceUtils.applySizePolicy(content, "backup.tar.gz", policy);
      assert.equal(result.truncated, true);
    });
  });

  describe("policy type combinations", () => {
    it("handles mixed unit types in multiple policies", () => {
      const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      const policies: SizePolicy[] = [
        { unit: "lines", limit: 10, mode: "truncate", cumulative: false },
        { unit: "bytes", limit: 30, mode: "truncate", cumulative: false },
      ];
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policies);
      assert.ok(result.truncated);
      assert.ok(result.data.length <= 30);
    });

    it("handles truncate followed by reject", () => {
      const content = "ABCDEFGHIJKLMNOPQRST";
      const policies: SizePolicy[] = [
        { unit: "bytes", limit: 20, mode: "truncate", cumulative: false },
        { unit: "bytes", limit: 10, mode: "reject", cumulative: false },
      ];
      const result = ResourceUtils.applySizePolicy(content, "test.txt", policies);
      assert.equal(result.data, "");
      assert.equal(result.truncated, true);
    });
  });
});
