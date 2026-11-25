import { strict as assert } from 'assert';
import type { expect as chaiExpect } from 'chai' with { 'resolution-mode': 'import' };
import { spawn, type ChildProcess } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

describe('Resource access', function() {
  let expect: typeof chaiExpect;
  const readKey = 'r'.repeat(32);
  const writeKey = 'w'.repeat(32);
  const deleteKey = 'd'.repeat(32);
  const otherKey = 'o'.repeat(32);
  const allKey = 'a'.repeat(32);
  const masterKey = 'm'.repeat(32);
  let temporaryDirectory: string;
  let root: string;
  let outside: string;
  let server: ChildProcess;
  let baseUrl: string;

  before(async function() {
    ({ expect } = await import('chai'));
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'navi-fs-resource-access-'));
    root = path.join(temporaryDirectory, 'public');
    outside = path.join(temporaryDirectory, 'public-secret');
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(root, 'nested', 'inside.txt'), 'inside');
    await writeFile(path.join(root, 'nested', 'authorization.txt'), 'original');
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(outside, path.join(root, 'outside-link'), 'dir');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'outside-file'));
    await symlink(path.join(root, 'nested'), path.join(root, 'inside-link'), 'dir');
    await symlink(root, path.join(root, 'nested', 'cycle'), 'dir');
    await symlink(path.join(root, 'missing'), path.join(root, 'dangling'));
    await symlink(root, path.join(temporaryDirectory, 'root-link'), 'dir');
    await writeFile(path.join(temporaryDirectory, 'config.yaml'), JSON.stringify({
      port: 9000,
      'log-level': 'error',
      'master-api-key': masterKey,
      resources: [
        {
          slug: 'logs',
          target: root,
          permissions: [
            { type: 'read', 'api-key': readKey },
            { type: 'write', 'api-key': writeKey },
            { type: 'delete', 'api-key': deleteKey },
            { type: 'all', 'api-key': allKey },
          ],
        },
        { slug: 'linked-root', target: path.join(temporaryDirectory, 'root-link'), permissions: [{ type: 'read', 'api-key': readKey }] },
        { slug: 'other', target: path.join(root, 'nested'), permissions: [{ type: 'read', 'api-key': otherKey }] },
        { slug: 'cfg', target: path.join(temporaryDirectory, 'config.yaml') },
      ],
    }));

    server = spawn(process.execPath, [path.join(__dirname, 'resource-test-server.cjs')], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let errors = '';
    server.stderr?.on('data', (data: Buffer) => { errors += data.toString(); });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('message', (message) => {
        if (typeof message === 'number') resolve(message);
        else reject(new Error('Invalid test server port'));
      });
      server.once('exit', (code) => reject(new Error(`Test server exited (${code}): ${errors}`)));
      server.once('error', reject);
    });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async function() {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => {
        server.once('exit', () => resolve());
        server.kill();
      });
    }
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const request = (endpoint: string, cursor: string, key = readKey, method = 'GET') => {
    const query = new URLSearchParams({ cursor, type: 'text' });
    return fetch(`${baseUrl}${endpoint}?${query}`, {
      method,
      headers: { 'x-api-key': key, 'content-type': 'text/plain' },
      ...(method === 'POST' ? { body: 'changed' } : {}),
    });
  };

  describe('authorization', function() {
    it('requires the master key for the resource list and master-only resources', async function() {
      for (const endpoint of ['/api/v1/', '/api/v1/cfg?type=text']) {
        expect((await fetch(`${baseUrl}${endpoint}`)).status).to.equal(401);
        expect((await fetch(`${baseUrl}${endpoint}`, { headers: { 'x-api-key': readKey } })).status).to.equal(403);
        expect((await fetch(`${baseUrl}${endpoint}`, { headers: { 'x-api-key': 'invalid' } })).status).to.equal(403);
      }

      const list = await fetch(`${baseUrl}/api/v1/`, { headers: { 'x-api-key': masterKey } });
      expect(list.status).to.equal(200);
      expect((await list.json() as { data: string[] }).data).to.include.members(['logs', 'other', 'cfg']);
      const config = await request('/api/v1/cfg', '', masterKey);
      expect(config.status).to.equal(200);
      expect(JSON.parse(await config.text())['master-api-key']).to.equal(masterKey);
    });

    it('restricts resource keys to their configured resources', async function() {
      const cursor = 'nested/authorization.txt';
      for (const key of [readKey, allKey]) {
        const response = await request('/api/v1/logs', cursor, key);
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal('original');
      }
      expect((await request('/api/v1/other', 'authorization.txt', otherKey)).status).to.equal(200);
      for (const key of [masterKey, otherKey, 'invalid']) {
        expect((await request('/api/v1/logs', cursor, key)).status).to.equal(403);
      }
      expect((await request('/api/v1/other', 'authorization.txt', readKey)).status).to.equal(403);
      expect((await fetch(`${baseUrl}/api/v1/logs?cursor=${cursor}`)).status).to.equal(403);
    });

    it('enforces operation-specific permissions', async function() {
      const cursor = 'nested/authorization.txt';
      for (const method of ['POST', 'DELETE']) {
        expect((await request('/api/v1/logs', cursor, readKey, method)).status).to.equal(403);
      }
      expect((await request('/api/v1/logs', cursor, writeKey)).status).to.equal(403);
      expect((await request('/api/v1/logs', cursor, writeKey, 'DELETE')).status).to.equal(403);
      expect((await request('/api/v1/logs', cursor, deleteKey)).status).to.equal(403);
      expect((await request('/api/v1/logs', cursor, deleteKey, 'POST')).status).to.equal(403);
      expect(await readFile(path.join(root, cursor), 'utf8')).to.equal('original');

      expect((await request('/api/v1/logs', cursor, writeKey, 'POST')).status).to.equal(201);
      expect(await readFile(path.join(root, cursor), 'utf8')).to.equal('changed');
      expect((await request('/api/v1/logs', cursor, deleteKey, 'DELETE')).status).to.equal(204);
      await assert.rejects(readFile(path.join(root, cursor)), { code: 'ENOENT' });
    });

  });

  describe('writes and deletes', function() {
    it('rejects invalid or oversized write bodies without changing the file', async function() {
      const file = path.join(root, 'nested', 'body.txt');
      await writeFile(file, 'original');
      const url = `${baseUrl}/api/v1/logs?cursor=nested%2Fbody.txt`;
      const headers = { 'x-api-key': writeKey };
      const invalid = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
      });
      expect(invalid.status).to.equal(400);
      expect(await readFile(file, 'utf8')).to.equal('original');
      const maximumBody = 'x'.repeat(100 * 1024);
      const maximum = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'text/plain' },
        body: maximumBody,
      });
      expect(maximum.status).to.equal(201);
      const oversized = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'text/plain' },
        body: 'x'.repeat(100 * 1024 + 1),
      });
      expect(oversized.status).to.equal(413);
      expect(await readFile(file, 'utf8')).to.equal(maximumBody);
    });

    it('requires force to delete a directory', async function() {
      const directory = path.join(root, 'nested', 'to-delete');
      await mkdir(directory);
      await writeFile(path.join(directory, 'file.txt'), 'content');
      const url = `${baseUrl}/api/v1/logs?cursor=nested%2Fto-delete`;
      const options = { method: 'DELETE', headers: { 'x-api-key': deleteKey } };
      expect((await fetch(url, options)).status).to.equal(400);
      expect(await readFile(path.join(directory, 'file.txt'), 'utf8')).to.equal('content');
      expect((await fetch(`${url}&force=true`, options)).status).to.equal(204);
      await assert.rejects(readFile(path.join(directory, 'file.txt')), { code: 'ENOENT' });
    });
  });

  describe('containment', function() {
    it('rejects traversal, absolute paths, sibling prefixes, and escaping symlinks', async function() {
      for (const cursor of [
        '../config.yaml',
        '../public-secret/secret.txt',
        path.join(outside, 'secret.txt'),
        'outside-link/secret.txt',
        'outside-file',
      ]) {
        const response = await request('/api/v1/logs', cursor);
        expect(response.status, cursor).to.equal(403);
      }
      const repeated = await fetch(`${baseUrl}/api/v1/logs?cursor=..&cursor=config.yaml&type=text`, {
        headers: { 'x-api-key': readKey },
      });
      expect(repeated.status).to.equal(403);
      expect((await request('/api/v1/cfg', '', readKey)).status).to.equal(403);
    });

    it('allows contained paths and symlinks, including a symlinked resource root', async function() {
      for (const [endpoint, cursor] of [
        ['/api/v1/logs', 'nested/../nested/inside.txt'],
        ['/api/v1/logs', 'inside-link/inside.txt'],
        ['/api/v1/linked-root', 'nested/inside.txt'],
      ]) {
        const response = await request(endpoint, cursor);
        expect(response.status).to.equal(200);
        expect(await response.text()).to.equal('inside');
      }
      const stream = await fetch(`${baseUrl}/api/v1/logs?cursor=nested%2Finside.txt`, {
        headers: { 'x-api-key': readKey },
      });
      expect(stream.status).to.equal(200);
      expect(await stream.text()).to.equal('inside');
    });

    it('does not traverse outside symlinks or cycles in recursive listings', async function() {
      const response = await fetch(`${baseUrl}/api/v1/logs?recursive=true`, { headers: { 'x-api-key': readKey } });
      expect(response.status).to.equal(200);
      const body = await response.json() as { data: string[] };
      expect(body.data).to.include('nested/inside.txt');
      expect(body.data).to.include('inside-link/inside.txt');
      expect(body.data.some((entry) => /outside|secret|cycle|dangling/.test(entry))).to.equal(false);
    });

    it('applies containment before writes and deletes', async function() {
      for (const method of ['POST', 'DELETE']) {
        for (const cursor of ['../public-secret/secret.txt', 'outside-link/secret.txt']) {
          expect((await request('/api/v1/logs', cursor, allKey, method)).status).to.equal(403);
        }
      }
      expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).to.equal('secret');
      expect((await request('/api/v1/logs', 'nested/inside.txt', allKey, 'POST')).status).to.equal(201);
      expect(await readFile(path.join(root, 'nested', 'inside.txt'), 'utf8')).to.equal('changed');
      expect((await request('/api/v1/logs', 'nested/inside.txt', allKey, 'DELETE')).status).to.equal(204);
    });
  });
});
