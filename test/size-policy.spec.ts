import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SizePolicy } from "../src/resources/schema";
import { ResourceUtils } from "../src/resources/utils";

describe("Size policy enforcement", () => {
  let temporaryDirectory: string;

  before(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "navi-fs-size-policy-"));
  });

  after(async () => {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("truncates content by bytes", () => {
    const content = "Hello World This is a test";
    const policy: SizePolicy = { unit: "bytes", limit: 11, mode: "truncate", cumulative: false };
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", policy);
    assert.equal(data, "Hello World");
    assert.equal(truncated, true);
  });

  it("truncates content by lines", () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4";
    const policy: SizePolicy = { unit: "lines", limit: 2, mode: "truncate", cumulative: false };
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", policy);
    assert.equal(data, "Line 1\nLine 2");
    assert.equal(truncated, true);
  });

  it("filters by extension", () => {
    const content = "Some content that should not be truncated";
    const policy: SizePolicy = {
      unit: "bytes",
      limit: 5,
      extensions: [".log"],
      mode: "truncate",
      cumulative: false,
    };
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", policy);
    assert.equal(data, content);
    assert.equal(truncated, false);
  });

  it("filters by pattern", () => {
    const content = "Some content that should not be truncated";
    const policy: SizePolicy = {
      unit: "bytes",
      limit: 5,
      pattern: ".*\\.log$",
      mode: "truncate",
      cumulative: false,
    };
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", policy);
    assert.equal(data, content);
    assert.equal(truncated, false);
  });

  it("applies multiple policies", () => {
    const content = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
    const policies: SizePolicy[] = [
      { unit: "lines", limit: 10, mode: "truncate", cumulative: false },
      { unit: "bytes", limit: 20, mode: "truncate", cumulative: false },
    ];
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", policies);
    assert.equal(data.length <= 20, true);
    assert.equal(truncated, true);
  });

  it("rejects content when mode is reject", () => {
    const content = "Some very long content";
    const policy: SizePolicy = {
      unit: "bytes",
      limit: 5,
      mode: "reject",
      cumulative: false,
    };
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", policy);
    assert.equal(data, "");
    assert.equal(truncated, true);
  });

  it("returns unmodified content when no policies apply", () => {
    const content = "Some content";
    const { data, truncated } = ResourceUtils.applySizePolicy(content, "test.txt", null);
    assert.equal(data, content);
    assert.equal(truncated, false);
  });
});

it("limits number of files in directory listing", () => {
  const files = ["file1.txt", "file2.txt", "file3.txt", "file4.txt", "file5.txt"];
  const policy: SizePolicy = { unit: "files", limit: 3, mode: "truncate", cumulative: false };
  const { data, truncated } = ResourceUtils.applySizePolicy(files, null, policy);
  assert.equal(data.length, 3);
  assert.deepEqual(data, ["file1.txt", "file2.txt", "file3.txt"]);
  assert.equal(truncated, true);
});

it("rejects all files when mode is reject", () => {
  const files = ["file1.txt", "file2.txt", "file3.txt"];
  const policy: SizePolicy = { unit: "files", limit: 1, mode: "reject", cumulative: false };
  const { data, truncated } = ResourceUtils.applySizePolicy(files, null, policy);
  assert.equal(data.length, 0);
  assert.equal(truncated, true);
});

it("applies multiple policies to file listing", () => {
  const files = Array(15)
    .fill(null)
    .map((_, i) => `file${i + 1}.txt`);
  const policies: SizePolicy[] = [
    { unit: "files", limit: 20, mode: "truncate", cumulative: false },
    { unit: "files", limit: 10, mode: "truncate", cumulative: false },
  ];
  const { data, truncated } = ResourceUtils.applySizePolicy(files, null, policies);
  assert.equal(data.length, 10);
  assert.equal(truncated, true);
});

it("allows unlimited files when no file policy is set", () => {
  const files = Array(1000)
    .fill(null)
    .map((_, i) => `file${i + 1}.txt`);
  const policy: SizePolicy = { unit: "bytes", limit: 1024, mode: "truncate", cumulative: false };
  const { data, truncated } = ResourceUtils.applySizePolicy(files, null, policy);
  assert.equal(data.length, 1000);
  assert.equal(truncated, false);
});
