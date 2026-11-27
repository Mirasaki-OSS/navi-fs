import { strict as assert } from "node:assert";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

describe("Index module", () => {
  let temporaryDirectory: string;
  let server: ChildProcess | undefined;
  const fixture = path.join(__dirname, "index-server.cjs");

  before(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "navi-fs-index-"));
    await writeFile(
      path.join(temporaryDirectory, "config.yaml"),
      JSON.stringify({
        port: 9000,
        "log-level": "error",
        "master-api-key": "m".repeat(32),
        resources: [],
      }),
    );
  });

  after(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => {
        server?.once("exit", () => resolve());
        server?.kill();
      });
    }
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("does not start a server when imported", async function () {
    this.timeout(7000);
    await promisify(execFile)(process.execPath, [fixture], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      timeout: 5000,
    });
  });

  it("allows size policies to be configured", async function () {
    this.timeout(7000);
    const validDirectory = await mkdtemp(path.join(temporaryDirectory, "valid-"));
    await writeFile(
      path.join(validDirectory, "config.yaml"),
      JSON.stringify({
        port: 9000,
        "master-api-key": "m".repeat(32),
        resources: [
          { slug: "files", target: validDirectory, "size-policy": { unit: "bytes", limit: 1024 } },
        ],
      }),
    );
    const testServer = spawn(process.execPath, [fixture, "serve"], {
      cwd: validDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: 5000,
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Server startup timeout")), 2000);
        testServer.once("message", (message) => {
          clearTimeout(timer);
          if (typeof message === "number") resolve(message);
          else reject(new Error("Invalid test server port"));
        });
        testServer.once("error", reject);
      });
      const response = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(response.status, 200);
    } finally {
      if (testServer && testServer.exitCode === null && testServer.signalCode === null) {
        await new Promise<void>((resolve) => {
          testServer.once("exit", () => resolve());
          testServer.kill();
        });
      }
    }
  });

  it("returns a working application without starting a server", async () => {
    server = spawn(process.execPath, [fixture, "serve"], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let errors = "";
    server.stderr?.on("data", (data: Buffer) => {
      errors += data.toString();
    });
    const port = await new Promise<number>((resolve, reject) => {
      server?.once("message", (message) => {
        if (typeof message === "number") resolve(message);
        else reject(new Error("Invalid test server port"));
      });
      server?.once("exit", (code) => reject(new Error(`Test server exited (${code}): ${errors}`)));
      server?.once("error", reject);
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { status: "alive" } });
  });

  it("handles rate-limit errors from middleware before the production router as JSON", async () => {
    const limitedServer = spawn(process.execPath, [fixture, "serve-limited"], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    try {
      let errors = "";
      limitedServer.stderr?.on("data", (data: Buffer) => {
        errors += data.toString();
      });
      const port = await new Promise<number>((resolve, reject) => {
        limitedServer.once("message", (message) => {
          if (typeof message === "number") resolve(message);
          else reject(new Error("Invalid test server port"));
        });
        limitedServer.once("exit", (code) =>
          reject(new Error(`Test server exited (${code}): ${errors}`)),
        );
        limitedServer.once("error", reject);
      });
      const url = `http://127.0.0.1:${port}/`;
      assert.equal((await fetch(url)).status, 200);
      const response = await fetch(url);
      assert.equal(response.status, 429);
      assert.equal(
        ((await response.json()) as { error: { code: string } }).error.code,
        "TOO_MANY_REQUESTS",
      );
    } finally {
      if (limitedServer.exitCode === null && limitedServer.signalCode === null) {
        await new Promise<void>((resolve) => {
          limitedServer.once("exit", () => resolve());
          limitedServer.kill();
        });
      }
    }
  });
});
