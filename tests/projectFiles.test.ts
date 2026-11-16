import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectFileAccess } from '../electron/projectFiles';

let sandboxDir: string;
let projectDir: string;
let outsideDir: string;

beforeEach(async () => {
  // realpath: on some systems the temp folder is itself a symbolic link.
  sandboxDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'engineer-ide-test-')));
  projectDir = path.join(sandboxDir, 'project');
  outsideDir = path.join(sandboxDir, 'outside');

  await fs.mkdir(path.join(projectDir, 'src', 'nested'), { recursive: true });
  await fs.mkdir(path.join(projectDir, 'assets'));
  await fs.writeFile(path.join(projectDir, 'README.md'), 'readme');
  await fs.writeFile(path.join(projectDir, 'file10.txt'), '');
  await fs.writeFile(path.join(projectDir, 'file2.txt'), '');
  await fs.writeFile(path.join(projectDir, 'src', 'index.ts'), '');
  await fs.mkdir(outsideDir);
  await fs.writeFile(path.join(outsideDir, 'private.txt'), 'private');
});

afterEach(async () => {
  await fs.rm(sandboxDir, { recursive: true, force: true });
});

describe('ProjectFileAccess.approveRoot', () => {
  it('returns the folder path and its display name', async () => {
    const access = new ProjectFileAccess();
    expect(await access.approveRoot(projectDir)).toEqual({
      ok: true,
      value: { path: projectDir, name: 'project' },
    });
  });

  it('rejects a path that is a file', async () => {
    const access = new ProjectFileAccess();
    const result = await access.approveRoot(path.join(projectDir, 'README.md'));
    expect(result.ok).toBe(false);
  });

  it('rejects a path that does not exist', async () => {
    const access = new ProjectFileAccess();
    const result = await access.approveRoot(path.join(sandboxDir, 'missing'));
    expect(result.ok).toBe(false);
  });
});

describe('ProjectFileAccess.readDir', () => {
  it('lists folders first, then files, in natural name order', async () => {
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    const result = await access.readDir(projectDir);
    expect(result).toEqual({
      ok: true,
      value: [
        { name: 'assets', path: path.join(projectDir, 'assets'), isDirectory: true },
        { name: 'src', path: path.join(projectDir, 'src'), isDirectory: true },
        { name: 'file2.txt', path: path.join(projectDir, 'file2.txt'), isDirectory: false },
        { name: 'file10.txt', path: path.join(projectDir, 'file10.txt'), isDirectory: false },
        { name: 'README.md', path: path.join(projectDir, 'README.md'), isDirectory: false },
      ],
    });
  });

  it('reads folders nested inside the approved folder', async () => {
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    const result = await access.readDir(path.join(projectDir, 'src'));
    expect(result.ok && result.value.map((node) => node.name)).toEqual(['nested', 'index.ts']);
  });

  it('denies every read before a folder has been approved', async () => {
    const access = new ProjectFileAccess();
    const result = await access.readDir(projectDir);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Access denied') });
  });

  it('denies a folder outside the approved folder', async () => {
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    const result = await access.readDir(outsideDir);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Access denied') });
  });

  it('denies parent-folder traversal out of the approved folder', async () => {
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    const result = await access.readDir(path.join(projectDir, '..', 'outside'));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Access denied') });
  });

  it('denies a sibling folder whose name starts with the approved folder name', async () => {
    const siblingDir = path.join(sandboxDir, 'project-secrets');
    await fs.mkdir(siblingDir);
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    const result = await access.readDir(siblingDir);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Access denied') });
  });

  it('allows a folder inside the project whose name starts with two dots', async () => {
    const dottedDir = path.join(projectDir, '..cache');
    await fs.mkdir(dottedDir);
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    expect(await access.readDir(dottedDir)).toEqual({ ok: true, value: [] });
  });

  // Creating symbolic links on Windows requires extra privileges.
  it.skipIf(process.platform === 'win32')(
    'denies a symbolic link that points outside the approved folder',
    async () => {
      const linkPath = path.join(projectDir, 'escape');
      await fs.symlink(outsideDir, linkPath, 'dir');
      const access = new ProjectFileAccess();
      await access.approveRoot(projectDir);
      const result = await access.readDir(linkPath);
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Access denied') });
    },
  );

  it.each([undefined, null, 42, '', { path: 'x' }, ['x']])(
    'rejects a non-string or empty path: %j',
    async (value) => {
      const access = new ProjectFileAccess();
      await access.approveRoot(projectDir);
      expect(await access.readDir(value)).toEqual({ ok: false, error: 'Invalid folder path.' });
    },
  );

  it('reports a missing folder as an error value instead of throwing', async () => {
    const access = new ProjectFileAccess();
    await access.approveRoot(projectDir);
    const result = await access.readDir(path.join(projectDir, 'missing'));
    expect(result.ok).toBe(false);
  });
});
