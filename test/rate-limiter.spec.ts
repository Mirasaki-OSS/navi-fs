import { strict as assert } from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("Rate limiter middleware", () => {
  let temporaryDirectory: string;
  let server: ChildProcess;
  let baseUrl: string;

  before(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "navi-fs-rate-limiter-"));
    await writeFile(
      path.join(temporaryDirectory, "config.yaml"),
      JSON.stringify({
        port: 9000,
        "log-level": "error",
        "master-api-key": "m".repeat(32),
        resources: [],
      }),
    );
    server = spawn(process.execPath, [path.join(__dirname, "rate-limiter-server.cjs")], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let errors = "";
    server.stderr?.on("data", (data: Buffer) => {
      errors += data.toString();
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once("message", (message) => {
        if (typeof message === "number") resolve(message);
        else reject(new Error("Invalid test server port"));
      });
      server.once("exit", (code) => reject(new Error(`Test server exited (${code}): ${errors}`)));
      server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => {
        server.once("exit", () => resolve());
        server.kill();
      });
    }
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("sets rate-limit headers and returns 429 when the limit is exhausted", async () => {
    const first = await fetch(`${baseUrl}/limited`);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-ratelimit-limit"), "1");
    assert.equal(first.headers.get("x-ratelimit-remaining"), "0");

    const second = await fetch(`${baseUrl}/limited`);
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("x-ratelimit-limit"), "1");
    assert.equal(second.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(second.headers.has("retry-after"));
    assert.equal(
      ((await second.json()) as { error: { code: string } }).error.code,
      "TOO_MANY_REQUESTS",
    );
  });

  it("returns 500 if the client IP is unavailable", async () => {
    const response = await fetch(`${baseUrl}/missing-ip`);
    assert.equal(response.status, 500);
  });

  it("returns 500 for backend errors and non-error rejections", async () => {
    for (const endpoint of ["/backend-error", "/non-error-rejection"]) {
      const response = await fetch(`${baseUrl}${endpoint}`);
      assert.equal(response.status, 500, endpoint);
      assert.equal(response.headers.get("retry-after"), null, endpoint);
    }
  });
});
