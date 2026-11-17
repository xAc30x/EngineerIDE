import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

/**
 * Phase 3a chose the built-in `node:sqlite` driver, run in a worker thread
 * (see "3a – Driver decision" in docs/ROADMAP.md). These tests fail if an
 * Electron or Node upgrade stops providing it, so the decision gets revisited
 * instead of breaking storage silently.
 */

// Opens an in-memory database, writes a row and reads it back.
const ROUND_TRIP_SCRIPT = `
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (x INTEGER)');
  db.prepare('INSERT INTO t (x) VALUES (?)').run(42);
  const row = db.prepare('SELECT x FROM t').get();
  db.close();
`;

describe('SQLite driver (node:sqlite)', () => {
  it('runs queries in the test runtime', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (x INTEGER)');
    db.prepare('INSERT INTO t (x) VALUES (?)').run(42);
    expect(db.prepare('SELECT x FROM t').get()).toEqual({ x: 42 });
    db.close();
  });

  it('runs queries inside a worker thread', async () => {
    const worker = new Worker(
      `${ROUND_TRIP_SCRIPT}
       require('node:worker_threads').parentPort.postMessage(row.x);`,
      { eval: true },
    );
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      expect(value).toBe(42);
    } finally {
      await worker.terminate();
    }
  });

  it("is available in the installed Electron's own Node", () => {
    // In Node, the `electron` package exports the path to the Electron binary.
    const electronPath = createRequire(import.meta.url)('electron') as string;
    const output = execFileSync(
      electronPath,
      ['-e', `${ROUND_TRIP_SCRIPT} process.stdout.write(String(row.x));`],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' },
    );
    expect(output).toBe('42');
  });
});
