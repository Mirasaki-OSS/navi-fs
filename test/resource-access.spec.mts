import { strict as assert } from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { expect as chaiExpect } from "chai";

describe("Resource access", () => {
  let expect: typeof chaiExpect;
  const readKey = "r".repeat(32);
  const writeKey = "w".repeat(32);
  const deleteKey = "d".repeat(32);
  const executeKey = "e".repeat(32);
  const otherKey = "o".repeat(32);
  const allKey = "a".repeat(32);
  const masterKey = "m".repeat(32);
  let temporaryDirectory: string;
  let root: string;
  let outside: string;
  let server: ChildProcess;
  let baseUrl: string;

  before(async () => {
    ({ expect } = await import("chai"));
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "navi-fs-resource-access-"));
    root = path.join(temporaryDirectory, "public");
    outside = path.join(temporaryDirectory, "public-secret");
    await mkdir(path.join(root, "nested"), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, "nested", "inside.txt"), "inside");
    await writeFile(path.join(root, "nested", "authorization.txt"), "original");
    await writeFile(path.join(root, "range.txt"), "0123456789");
    const oldTime = new Date(Date.now() - 120000);
    await utimes(path.join(root, "range.txt"), oldTime, oldTime);
    await writeFile(path.join(root, "empty.txt"), "");
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "outside-link"), "dir");
    await symlink(path.join(outside, "secret.txt"), path.join(root, "outside-file"));
    await symlink(path.join(root, "nested"), path.join(root, "inside-link"), "dir");
    await symlink(root, path.join(root, "nested", "cycle"), "dir");
    await symlink(path.join(root, "missing"), path.join(root, "dangling"));
    await symlink(root, path.join(temporaryDirectory, "root-link"), "dir");
    await writeFile(
      path.join(temporaryDirectory, "config.yaml"),
      JSON.stringify({
        port: 9000,
        "log-level": "error",
        "master-api-key": masterKey,
        resources: [
          {
            slug: "logs",
            target: root,
            permissions: [
              { type: "read", "api-key": readKey },
              { type: "write", "api-key": writeKey },
              { type: "delete", "api-key": deleteKey },
              { type: "all", "api-key": allKey },
            ],
          },
          {
            slug: "linked-root",
            target: path.join(temporaryDirectory, "root-link"),
            permissions: [{ type: "read", "api-key": readKey }],
          },
          {
            slug: "other",
            target: path.join(root, "nested"),
            permissions: [{ type: "read", "api-key": otherKey }],
          },
          {
            slug: "run",
            target: root,
            executable: { command: "pwd", cwd: root },
            permissions: [
              { type: "execute", "api-key": executeKey },
              { type: "read", "api-key": readKey },
            ],
          },
          {
            slug: "run-file",
            target: path.join(root, "range.txt"),
            executable: { command: "pwd", cwd: root },
            permissions: [{ type: "execute", "api-key": executeKey }],
          },
          {
            slug: "run-error",
            target: root,
            executable: { command: "pwd >&2; exit 7", cwd: root },
            permissions: [{ type: "execute", "api-key": executeKey }],
          },
          {
            slug: "run-missing-cwd",
            target: root,
            executable: { command: "pwd", cwd: path.join(root, "missing") },
            permissions: [{ type: "execute", "api-key": executeKey }],
          },
          {
            slug: "run-timeout",
            target: root,
            executable: { command: "sleep 5", cwd: root, timeout: 1 },
            permissions: [{ type: "execute", "api-key": executeKey }],
          },
          { slug: "cfg", target: path.join(temporaryDirectory, "config.yaml") },
        ],
      }),
    );

    server = spawn(process.execPath, [path.join(__dirname, "resource-test-server.cjs")], {
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

  const request = (endpoint: string, cursor: string, key = readKey, method = "GET") => {
    const query = new URLSearchParams({ cursor, type: "text" });
    return fetch(`${baseUrl}${endpoint}?${query}`, {
      method,
      headers: { "x-api-key": key, "content-type": "text/plain" },
      ...(method === "POST" ? { body: "changed" } : {}),
    });
  };

  describe("master authorization", () => {
    it("requires the master key for the resource list and master-only resources", async () => {
      for (const endpoint of ["/api/v1/", "/api/v1/cfg?type=text"]) {
        expect((await fetch(`${baseUrl}${endpoint}`)).status).to.equal(401);
        expect(
          (await fetch(`${baseUrl}${endpoint}`, { headers: { "x-api-key": readKey } })).status,
        ).to.equal(403);
        expect(
          (await fetch(`${baseUrl}${endpoint}`, { headers: { "x-api-key": "invalid" } })).status,
        ).to.equal(403);
      }

      const list = await fetch(`${baseUrl}/api/v1/`, { headers: { "x-api-key": masterKey } });
      expect(list.status).to.equal(200);
      expect(((await list.json()) as { data: string[] }).data).to.include.members([
        "logs",
        "other",
        "cfg",
      ]);
      const config = await request("/api/v1/cfg", "", masterKey);
      expect(config.status).to.equal(200);
      expect(JSON.parse(await config.text())["master-api-key"]).to.equal(masterKey);
    });
  });

  describe("HTTP methods", () => {
    it("applies read authorization and GET status and headers to HEAD", async () => {
      const url = `${baseUrl}/api/v1/run?cursor=range.txt`;
      const headers = { "x-api-key": readKey };
      const get = await fetch(url, { headers });
      const head = await fetch(url, { method: "HEAD", headers });
      expect(head.status).to.equal(get.status);
      for (const header of [
        "content-length",
        "content-type",
        "content-disposition",
        "etag",
        "last-modified",
        "accept-ranges",
        "cache-control",
      ]) {
        expect(head.headers.get(header), header).to.equal(get.headers.get(header));
      }
      expect(await head.text()).to.equal("");
      expect(head.headers.get("cache-control")).to.equal("no-store");
      expect(
        (await fetch(url, { method: "HEAD", headers: { "x-api-key": executeKey } })).status,
      ).to.equal(403);
      expect(
        (await fetch(`${baseUrl}/api/v1/run?cursor=missing`, { method: "HEAD", headers })).status,
      ).to.equal(404);
      expect(
        (await fetch(`${baseUrl}/api/v1/run?cursor=..%2Fconfig.yaml`, { method: "HEAD", headers }))
          .status,
      ).to.equal(403);
      const conditional = await fetch(url, {
        method: "HEAD",
        headers: {
          ...headers,
          "cache-control": "max-age=0",
          pragma: "cache",
          "if-none-match": get.headers.get("etag") ?? "",
        },
      });
      expect(conditional.status).to.equal(304);
      for (const method of ["GET", "HEAD"]) {
        const precondition = await fetch(url, {
          method,
          headers: {
            ...headers,
            "if-match": '"different"',
            "if-none-match": get.headers.get("etag") ?? "",
          },
        });
        expect(precondition.status).to.equal(412);
        if (method === "GET") {
          expect(precondition.headers.get("content-type")).to.include("application/json");
          expect(precondition.headers.get("content-disposition")).to.equal(null);
          expect(((await precondition.json()) as { error: { code: string } }).error.code).to.equal(
            "PRECONDITION_FAILED",
          );
        }
        const weakMatch = await fetch(url, {
          method,
          headers: { ...headers, "if-match": get.headers.get("etag") ?? "" },
        });
        expect(weakMatch.status).to.equal(412);
        const wildcard = await fetch(url, {
          method,
          headers: {
            ...headers,
            "if-match": "*",
            "if-unmodified-since": "Thu, 01 Jan 1970 00:00:00 GMT",
          },
        });
        expect(wildcard.status).to.equal(200);
      }
      const headRange = await fetch(url, {
        method: "HEAD",
        headers: { ...headers, range: "bytes=0-1" },
      });
      expect(headRange.status).to.equal(200);
      expect(headRange.headers.get("content-length")).to.equal("10");
    });

    it("handles public OPTIONS and unsupported methods consistently", async () => {
      for (const [endpoint, allowed] of [
        ["/", "GET, HEAD, OPTIONS"],
        ["/api/v1/", "GET, HEAD, OPTIONS"],
        ["/api/v1/logs", "GET, HEAD, POST, DELETE, OPTIONS"],
        ["/api/v1/run/execute", "POST, OPTIONS"],
      ]) {
        const options = await fetch(`${baseUrl}${endpoint}`, { method: "OPTIONS" });
        expect(options.status).to.equal(204);
        expect(options.headers.get("allow")).to.equal(allowed);
        const unsupported = await fetch(`${baseUrl}${endpoint}`, { method: "PUT" });
        expect(unsupported.status).to.equal(405);
        expect(unsupported.headers.get("allow")).to.equal(allowed);
        expect(((await unsupported.json()) as { error: { code: string } }).error.code).to.equal(
          "METHOD_NOT_ALLOWED",
        );
      }
      expect((await fetch(`${baseUrl}/api/v1/unknown`, { method: "OPTIONS" })).status).to.equal(
        404,
      );
      expect((await fetch(`${baseUrl}/api/v1/unknown`, { method: "PUT" })).status).to.equal(404);
      const missing = await fetch(`${baseUrl}/not-a-route`);
      expect(missing.status).to.equal(404);
      expect(((await missing.json()) as { error: { code: string } }).error.code).to.equal(
        "NOT_FOUND",
      );
    });

    it("returns 404 for missing targets across resource methods", async () => {
      for (const [method, key] of [
        ["GET", readKey],
        ["POST", writeKey],
        ["DELETE", deleteKey],
      ]) {
        const response = await request("/api/v1/logs", "missing.txt", key, method);
        expect(response.status, method).to.equal(404);
        expect(((await response.json()) as { error: { code: string } }).error.code).to.equal(
          "NOT_FOUND",
        );
      }
      expect((await request("/api/v1/logs", "range.txt/missing", readKey)).status).to.equal(404);
    });
  });

  describe("streaming ranges", () => {
    it("serves single byte ranges and reports unsatisfiable ranges", async () => {
      const url = `${baseUrl}/api/v1/logs?cursor=range.txt`;
      const headers = { "x-api-key": readKey };
      for (const [range, expected, contentRange] of [
        ["bytes=2-5", "2345", "bytes 2-5/10"],
        ["bytes=7-", "789", "bytes 7-9/10"],
        ["bytes=-3", "789", "bytes 7-9/10"],
      ] as const) {
        const response = await fetch(url, {
          headers: { ...headers, range, "accept-encoding": "gzip" },
        });
        expect(response.status, range).to.equal(206);
        expect(response.headers.get("content-range")).to.equal(contentRange);
        expect(response.headers.get("content-length")).to.equal(String(expected.length));
        expect(response.headers.get("content-encoding")).to.equal(null);
        expect(await response.text()).to.equal(expected);
      }
      for (const [cursor, range, size] of [
        ["range.txt", "bytes=10-", 10],
        ["empty.txt", "bytes=0-0", 0],
      ] as const) {
        const response = await fetch(`${baseUrl}/api/v1/logs?cursor=${cursor}`, {
          headers: { ...headers, range },
        });
        expect(response.status).to.equal(416);
        expect(response.headers.get("content-range")).to.equal(`bytes */${size}`);
        expect(response.headers.get("content-type")).to.include("application/json");
        expect(response.headers.get("content-disposition")).to.equal(null);
        expect(((await response.json()) as { error: { code: string } }).error.code).to.equal(
          "RANGE_NOT_SATISFIABLE",
        );
      }
    });

    it("handles validators and does not advertise ranges for transformed responses", async () => {
      const url = `${baseUrl}/api/v1/logs?cursor=range.txt`;
      const headers = { "x-api-key": readKey };
      const full = await fetch(url, { headers });
      const etag = full.headers.get("etag") ?? "";
      const lastModified = full.headers.get("last-modified") ?? "";
      expect(etag).to.match(/^W\//);
      expect(full.headers.get("content-range")).to.equal(null);
      expect(await full.text()).to.equal("0123456789");
      const matching = await fetch(url, {
        headers: { ...headers, range: "bytes=0-1", "if-range": lastModified },
      });
      expect(matching.status).to.equal(206);
      expect(await matching.text()).to.equal("01");
      const stale = await fetch(url, {
        headers: { ...headers, range: "bytes=0-1", "if-range": '"stale"' },
      });
      expect(stale.status).to.equal(200);
      expect(await stale.text()).to.equal("0123456789");
      const laterDate = new Date(Date.parse(lastModified) + 60000).toUTCString();
      const differentDate = await fetch(url, {
        headers: { ...headers, range: "bytes=0-1", "if-range": laterDate },
      });
      expect(differentDate.status).to.equal(200);
      const weak = await fetch(url, {
        headers: { ...headers, range: "bytes=0-1", "if-range": etag },
      });
      expect(weak.status).to.equal(200);
      expect(await weak.text()).to.equal("0123456789");
      const recentUrl = `${baseUrl}/api/v1/logs?cursor=nested%2Finside.txt`;
      const recent = await fetch(recentUrl, { headers });
      const recentRange = await fetch(recentUrl, {
        headers: {
          ...headers,
          range: "bytes=0-1",
          "if-range": recent.headers.get("last-modified") ?? "",
        },
      });
      expect(recentRange.status).to.equal(200);
      const noCache = await fetch(url, {
        headers: {
          ...headers,
          pragma: "no-cache",
          "cache-control": "max-age=0",
          "if-none-match": etag,
        },
      });
      expect(noCache.status).to.equal(200);
      expect(await noCache.text()).to.equal("0123456789");
      const multi = await fetch(url, { headers: { ...headers, range: "bytes=0-1,4-5" } });
      expect(multi.status).to.equal(200);
      expect(await multi.text()).to.equal("0123456789");
      const text = await fetch(`${url}&type=text`, { headers: { ...headers, range: "bytes=0-1" } });
      expect(text.status).to.equal(200);
      expect(text.headers.get("etag")).not.to.equal(etag);
      expect(text.headers.get("accept-ranges")).to.equal(null);
      expect(text.headers.get("content-range")).to.equal(null);
      expect(await text.text()).to.equal("0123456789");
    });

    it("streams a large file intact and supports ranges near its end", async () => {
      const contents = Buffer.from("0123456789abcdef".repeat(128 * 1024));
      await writeFile(path.join(root, "large.bin"), contents);
      const url = `${baseUrl}/api/v1/logs?cursor=large.bin`;
      const headers = { "x-api-key": readKey, "accept-encoding": "identity" };
      const response = await fetch(url, { headers });
      expect(response.status).to.equal(200);
      expect(response.headers.get("content-length")).to.equal(String(contents.length));
      assert.ok(response.body);
      const hash = createHash("sha256");
      let total = 0;
      for await (const chunk of response.body) {
        hash.update(chunk);
        total += chunk.length;
      }
      expect(total).to.equal(contents.length);
      expect(hash.digest("hex")).to.equal(createHash("sha256").update(contents).digest("hex"));
      const start = contents.length - 37;
      const range = await fetch(url, { headers: { ...headers, range: `bytes=${start}-` } });
      expect(range.status).to.equal(206);
      expect(range.headers.get("content-range")).to.equal(
        `bytes ${start}-${contents.length - 1}/${contents.length}`,
      );
      expect(Buffer.from(await range.arrayBuffer()).equals(contents.subarray(start))).to.equal(
        true,
      );
    });
  });

  describe("execution", () => {
    it("requires execute permission and respects the configured or cursor working directory", async () => {
      const url = `${baseUrl}/api/v1/run/execute`;
      const call = (key: string, cursor?: string) =>
        fetch(`${url}${cursor ? `?${new URLSearchParams({ cursor })}` : ""}`, {
          method: "POST",
          headers: { "x-api-key": key },
        });
      expect((await call(readKey)).status).to.equal(403);
      expect((await call(writeKey)).status).to.equal(403);
      for (const [cursor, cwd] of [
        [undefined, root],
        ["nested", path.join(root, "nested")],
      ]) {
        const response = await call(executeKey, cursor);
        expect(response.status).to.equal(200);
        expect(response.headers.get("content-type")).to.include("text/event-stream");
        const body = await response.text();
        expect(body).to.include(`event: stdout\ndata: ${cwd}`);
        expect(body).to.include("event: exit\ndata: Process exited with code 0");
      }
      const linked = await call(executeKey, "inside-link");
      expect(linked.status).to.equal(200);
      expect(await linked.text()).to.include(`event: stdout\ndata: ${path.join(root, "nested")}`);
      expect((await call(executeKey, "../public-secret")).status).to.equal(403);
      expect((await call(executeKey, "outside-link")).status).to.equal(403);
      expect((await call(executeKey, "range.txt")).status).to.equal(400);
      expect((await call(executeKey, "missing")).status).to.equal(404);
      expect(
        (
          await fetch(`${baseUrl}/api/v1/logs/execute`, {
            method: "POST",
            headers: { "x-api-key": allKey },
          })
        ).status,
      ).to.equal(400);
      const fileUrl = `${baseUrl}/api/v1/run-file/execute`;
      const options = { method: "POST", headers: { "x-api-key": executeKey } };
      expect((await fetch(`${fileUrl}?cursor=nested`, options)).status).to.equal(400);
      const file = await fetch(fileUrl, options);
      expect(file.status).to.equal(200);
      expect(await file.text()).to.include(`event: stdout\ndata: ${root}`);
    });

    it("streams stderr and nonzero exit status", async () => {
      const response = await fetch(`${baseUrl}/api/v1/run-error/execute`, {
        method: "POST",
        headers: { "x-api-key": executeKey },
      });
      const body = await response.text();
      expect(body).to.include(`event: stderr\ndata: ${root}`);
      expect(body).to.include("event: exit\ndata: Process exited with code 7");
    });

    it("reports spawn errors without attempting to write a second event after closing", async () => {
      const response = await fetch(`${baseUrl}/api/v1/run-missing-cwd/execute`, {
        method: "POST",
        headers: { "x-api-key": executeKey },
      });
      expect(response.status).to.equal(200);
      const body = await response.text();
      expect(body).to.include("event: error");
      expect(body).not.to.include("event: exit");
      expect((await fetch(`${baseUrl}/`)).status).to.equal(200);
    });

    it("applies execution timeouts in seconds", async function () {
      this.timeout(5000);
      const response = await fetch(`${baseUrl}/api/v1/run-timeout/execute`, {
        method: "POST",
        headers: { "x-api-key": executeKey },
      });
      expect(response.status).to.equal(200);
      expect(await response.text()).to.include(
        "event: exit\ndata: Process terminated by signal SIGTERM",
      );
    });
  });

  describe("resource authorization", () => {
    it("restricts resource keys to their configured resources", async () => {
      const cursor = "nested/authorization.txt";
      for (const key of [readKey, allKey]) {
        const response = await request("/api/v1/logs", cursor, key);
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal("original");
      }
      expect((await request("/api/v1/other", "authorization.txt", otherKey)).status).to.equal(200);
      for (const key of [masterKey, otherKey, "invalid"]) {
        expect((await request("/api/v1/logs", cursor, key)).status).to.equal(403);
      }
      expect((await request("/api/v1/other", "authorization.txt", readKey)).status).to.equal(403);
      expect((await fetch(`${baseUrl}/api/v1/logs?cursor=${cursor}`)).status).to.equal(403);
    });

    it("does not echo API keys in authorization errors", async () => {
      for (const endpoint of ["/api/v1/", "/api/v1/logs"]) {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          headers: { "x-api-key": otherKey },
        });
        expect(response.status).to.equal(403);
        expect(await response.text()).not.to.include(otherKey);
      }
    });

    it("enforces operation-specific permissions", async () => {
      const cursor = "nested/authorization.txt";
      for (const method of ["POST", "DELETE"]) {
        expect((await request("/api/v1/logs", cursor, readKey, method)).status).to.equal(403);
      }
      expect((await request("/api/v1/logs", cursor, writeKey)).status).to.equal(403);
      expect((await request("/api/v1/logs", cursor, writeKey, "DELETE")).status).to.equal(403);
      expect((await request("/api/v1/logs", cursor, deleteKey)).status).to.equal(403);
      expect((await request("/api/v1/logs", cursor, deleteKey, "POST")).status).to.equal(403);
      expect(await readFile(path.join(root, cursor), "utf8")).to.equal("original");

      expect((await request("/api/v1/logs", cursor, writeKey, "POST")).status).to.equal(201);
      expect(await readFile(path.join(root, cursor), "utf8")).to.equal("changed");
      expect((await request("/api/v1/logs", cursor, deleteKey, "DELETE")).status).to.equal(204);
      await assert.rejects(readFile(path.join(root, cursor)), { code: "ENOENT" });
    });
  });

  describe("writes and deletes", () => {
    it("rejects invalid or oversized write bodies without changing the file", async () => {
      const file = path.join(root, "nested", "body.txt");
      await writeFile(file, "original");
      const url = `${baseUrl}/api/v1/logs?cursor=nested%2Fbody.txt`;
      const headers = { "x-api-key": writeKey };
      const invalid = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "{}",
      });
      expect(invalid.status).to.equal(400);
      expect(await readFile(file, "utf8")).to.equal("original");
      const maximumBody = "x".repeat(100 * 1024);
      const maximum = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain" },
        body: maximumBody,
      });
      expect(maximum.status).to.equal(201);
      const oversized = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain" },
        body: "x".repeat(100 * 1024 + 1),
      });
      expect(oversized.status).to.equal(413);
      expect(((await oversized.json()) as { error: { code: string } }).error.code).to.equal(
        "PAYLOAD_TOO_LARGE",
      );
      expect(await readFile(file, "utf8")).to.equal(maximumBody);
      const unsupported = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "text/plain; charset=not-a-charset" },
        body: "content",
      });
      expect(unsupported.status).to.equal(415);
      expect(((await unsupported.json()) as { error: { code: string } }).error.code).to.equal(
        "UNSUPPORTED_MEDIA_TYPE",
      );
      expect(await readFile(file, "utf8")).to.equal(maximumBody);
    });

    it("requires force to delete a directory", async () => {
      const directory = path.join(root, "nested", "to-delete");
      await mkdir(directory);
      await writeFile(path.join(directory, "file.txt"), "content");
      const url = `${baseUrl}/api/v1/logs?cursor=nested%2Fto-delete`;
      const options = { method: "DELETE", headers: { "x-api-key": deleteKey } };
      expect((await fetch(url, options)).status).to.equal(400);
      expect(await readFile(path.join(directory, "file.txt"), "utf8")).to.equal("content");
      expect((await fetch(`${url}&force=true`, options)).status).to.equal(204);
      await assert.rejects(readFile(path.join(directory, "file.txt")), { code: "ENOENT" });
    });
  });

  describe("containment", () => {
    it("rejects traversal, absolute paths, sibling prefixes, and escaping symlinks", async () => {
      for (const cursor of [
        "../config.yaml",
        "../public-secret/secret.txt",
        path.join(outside, "secret.txt"),
        "outside-link/secret.txt",
        "outside-file",
      ]) {
        const response = await request("/api/v1/logs", cursor);
        expect(response.status, cursor).to.equal(403);
      }
      const repeated = await fetch(
        `${baseUrl}/api/v1/logs?cursor=..&cursor=config.yaml&type=text`,
        {
          headers: { "x-api-key": readKey },
        },
      );
      expect(repeated.status).to.equal(403);
      expect((await request("/api/v1/cfg", "", readKey)).status).to.equal(403);
    });

    it("allows contained paths and symlinks, including a symlinked resource root", async () => {
      for (const [endpoint, cursor] of [
        ["/api/v1/logs", "nested/../nested/inside.txt"],
        ["/api/v1/logs", "inside-link/inside.txt"],
        ["/api/v1/linked-root", "nested/inside.txt"],
      ] as const) {
        const response = await request(endpoint, cursor);
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal("inside");
      }
      const stream = await fetch(`${baseUrl}/api/v1/logs?cursor=nested%2Finside.txt`, {
        headers: { "x-api-key": readKey },
      });
      expect(stream.status).to.equal(200);
      expect(await stream.text()).to.equal("inside");
    });

    it("does not traverse outside symlinks or cycles in recursive listings", async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?recursive=true`, {
        headers: { "x-api-key": readKey },
      });
      expect(response.status).to.equal(200);
      const body = (await response.json()) as { data: string[] };
      expect(body.data).to.include("nested/inside.txt");
      expect(body.data).to.include("inside-link/inside.txt");
      expect(body.data.some((entry) => /outside|secret|cycle|dangling/.test(entry))).to.equal(
        false,
      );
    });

    it("applies containment before writes and deletes", async () => {
      for (const method of ["POST", "DELETE"]) {
        for (const cursor of ["../public-secret/secret.txt", "outside-link/secret.txt"]) {
          expect((await request("/api/v1/logs", cursor, allKey, method)).status).to.equal(403);
        }
      }
      expect(await readFile(path.join(outside, "secret.txt"), "utf8")).to.equal("secret");
      expect((await request("/api/v1/logs", "nested/inside.txt", allKey, "POST")).status).to.equal(
        201,
      );
      expect(await readFile(path.join(root, "nested", "inside.txt"), "utf8")).to.equal("changed");
      expect(
        (await request("/api/v1/logs", "nested/inside.txt", allKey, "DELETE")).status,
      ).to.equal(204);
    });
  });
});
