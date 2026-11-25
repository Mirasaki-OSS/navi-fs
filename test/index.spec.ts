import { strict as assert } from 'assert';
import { execFile, spawn, type ChildProcess } from 'child_process';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

describe('Index module', function() {
  let temporaryDirectory: string;
  let server: ChildProcess | undefined;
  const fixture = path.join(__dirname, 'index-server.cjs');

  before(async function() {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'navi-fs-index-'));
    await writeFile(path.join(temporaryDirectory, 'config.yaml'), JSON.stringify({
      port: 9000,
      'log-level': 'error',
      'master-api-key': 'm'.repeat(32),
      resources: [],
    }));
  });

  after(async function() {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => {
        server?.once('exit', () => resolve());
        server?.kill();
      });
    }
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('does not start a server when imported', async function() {
    this.timeout(7000);
    await promisify(execFile)(process.execPath, [fixture], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: 'production' },
      timeout: 5000,
    });
  });

  it('returns a working application without starting a server', async function() {
    server = spawn(process.execPath, [fixture, 'serve'], {
      cwd: temporaryDirectory,
      env: { ...process.env, NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let errors = '';
    server.stderr?.on('data', (data: Buffer) => { errors += data.toString(); });
    const port = await new Promise<number>((resolve, reject) => {
      server?.once('message', (message) => {
        if (typeof message === 'number') resolve(message);
        else reject(new Error('Invalid test server port'));
      });
      server?.once('exit', (code) => reject(new Error(`Test server exited (${code}): ${errors}`)));
      server?.once('error', reject);
    });
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { status: 'alive' } });
  });
});
