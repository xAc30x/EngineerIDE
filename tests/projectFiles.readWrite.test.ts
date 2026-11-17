import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_TEXT_FILE_BYTES, ProjectFileAccess, checkSave } from '../electron/projectFiles';
import type { FileContent, FileSaveResult, IpcResult } from '../shared/types';

let sandboxDir: string;
let projectDir: string;
let outsideDir: string;
let access: ProjectFileAccess;

beforeEach(async () => {
  // realpath: on some systems the temp folder is itself a symbolic link.
  sandboxDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'engineer-ide-rw-')));
  projectDir = path.join(sandboxDir, 'project');
  outsideDir = path.join(sandboxDir, 'outside');
  await fs.mkdir(path.join(projectDir, 'src'), { recursive: true });
  await fs.mkdir(outsideDir);
  await fs.writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(outsideDir, 'private.txt'), 'private');
  access = new ProjectFileAccess();
  await access.approveRoot(projectDir);
});

afterEach(async () => {
  await fs.rm(sandboxDir, { recursive: true, force: true });
});

function valueOf<T>(result: IpcResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected ok, got: ${result.error}`);
  }
  return result.value;
}

/** Moves a file's modification time, as another program saving it would. */
async function touchLater(filePath: string, secondsLater = 10): Promise<void> {
  const stats = await fs.stat(filePath);
  const later = new Date(stats.mtimeMs + secondsLater * 1000);
  await fs.utimes(filePath, later, later);
}

describe('checkSave', () => {
  it('allows a save when the time on disk is the one that was read', () => {
    expect(checkSave(1_700_000_000_123.456, { mtimeMs: 1_700_000_000_123.456 })).toBeNull();
  });

  it('refuses when the time on disk is newer or older', () => {
    expect(checkSave(1000, { mtimeMs: 2000 })).toEqual({
      status: 'changedOnDisk',
      mtimeMs: 2000,
    });
    expect(checkSave(2000, { mtimeMs: 1000 })).toEqual({
      status: 'changedOnDisk',
      mtimeMs: 1000,
    });
  });

  it('refuses when the file is gone', () => {
    expect(checkSave(1000, null)).toEqual({ status: 'missing' });
  });
});

describe('ProjectFileAccess.readFile', () => {
  it('returns the text and the modification time', async () => {
    const file = path.join(projectDir, 'src', 'index.ts');
    const read = valueOf(await access.readFile(file));
    expect(read).toEqual<FileContent>({
      content: 'export const a = 1;\n',
      mtimeMs: (await fs.stat(file)).mtimeMs,
    });
  });

  it('refuses a folder', async () => {
    const result = await access.readFile(path.join(projectDir, 'src'));
    expect(result).toEqual({ ok: false, error: 'The path is not a file.' });
  });

  it('refuses a file outside the project', async () => {
    const result = await access.readFile(path.join(outsideDir, 'private.txt'));
    expect(result.ok).toBe(false);
  });

  // Creating a symbolic link needs extra rights on Windows, as in projectFiles.test.ts.
  it.skipIf(process.platform === 'win32')(
    'refuses a symbolic link inside the project that points outside it',
    async () => {
      const link = path.join(projectDir, 'link.txt');
      await fs.symlink(path.join(outsideDir, 'private.txt'), link);
      const result = await access.readFile(link);
      expect(result).toEqual({
        ok: false,
        error: 'Access denied: the file is outside the selected project folder.',
      });
    },
  );

  it('refuses a binary file and invalid UTF-8', async () => {
    const binary = path.join(projectDir, 'image.bin');
    await fs.writeFile(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    expect(await access.readFile(binary)).toEqual({
      ok: false,
      error: 'The file is not UTF-8 text.',
    });

    const latin1 = path.join(projectDir, 'latin1.txt');
    await fs.writeFile(latin1, Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
    expect(await access.readFile(latin1)).toEqual({
      ok: false,
      error: 'The file is not UTF-8 text.',
    });
  });

  it('refuses a file over the size limit', async () => {
    const big = path.join(projectDir, 'big.txt');
    await fs.writeFile(big, Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 0x61));
    const result = await access.readFile(big);
    expect(result.ok).toBe(false);
  });

  it('refuses a missing file and malformed paths', async () => {
    expect((await access.readFile(path.join(projectDir, 'missing.txt'))).ok).toBe(false);
    expect(await access.readFile('')).toEqual({
      ok: false,
      error: 'Invalid file path.',
    });
    expect(await access.readFile(42)).toEqual({
      ok: false,
      error: 'Invalid file path.',
    });
  });

  it('refuses everything before a folder is approved', async () => {
    const fresh = new ProjectFileAccess();
    expect((await fresh.readFile(path.join(projectDir, 'src', 'index.ts'))).ok).toBe(false);
  });
});

describe('ProjectFileAccess.writeFile', () => {
  it('saves with the read time, returns the new time, and saves again with it', async () => {
    const file = path.join(projectDir, 'src', 'index.ts');
    const read = valueOf(await access.readFile(file));

    const first = valueOf(await access.writeFile(file, 'export const a = 2;\n', read.mtimeMs));
    expect(first.status).toBe('saved');
    expect(await fs.readFile(file, 'utf8')).toBe('export const a = 2;\n');
    const firstTime = (first as Extract<FileSaveResult, { status: 'saved' }>).mtimeMs;
    expect(firstTime).toBe((await fs.stat(file)).mtimeMs);

    const second = valueOf(await access.writeFile(file, 'short\n', firstTime));
    expect(second.status).toBe('saved');
    // Shorter content leaves no bytes of the old content behind.
    expect(await fs.readFile(file, 'utf8')).toBe('short\n');
  });

  it('refuses a save after the file changed on disk, and leaves it unchanged', async () => {
    const file = path.join(projectDir, 'src', 'index.ts');
    const read = valueOf(await access.readFile(file));
    await fs.writeFile(file, 'changed elsewhere\n');
    await touchLater(file);
    const onDisk = (await fs.stat(file)).mtimeMs;

    const result = await access.writeFile(file, 'my edit\n', read.mtimeMs);
    expect(result).toEqual({
      ok: true,
      value: { status: 'changedOnDisk', mtimeMs: onDisk },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('changed elsewhere\n');
    expect((await fs.stat(file)).mtimeMs).toBe(onDisk);
  });

  it('refuses a save after the file was deleted, and does not create it', async () => {
    const file = path.join(projectDir, 'src', 'index.ts');
    const read = valueOf(await access.readFile(file));
    await fs.rm(file);

    expect(await access.writeFile(file, 'my edit\n', read.mtimeMs)).toEqual({
      ok: true,
      value: { status: 'missing' },
    });
    await expect(fs.stat(file)).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a file outside the project, directly or through a symbolic link',
    async () => {
      const outside = path.join(outsideDir, 'private.txt');
      const mtimeMs = (await fs.stat(outside)).mtimeMs;
      const link = path.join(projectDir, 'link.txt');
      await fs.symlink(outside, link);

      expect((await access.writeFile(outside, 'x', mtimeMs)).ok).toBe(false);
      expect(await access.writeFile(link, 'x', mtimeMs)).toEqual({
        ok: false,
        error: 'Access denied: the file is outside the selected project folder.',
      });
      expect(await fs.readFile(outside, 'utf8')).toBe('private');
    },
  );

  it('does not say whether a missing file outside the project exists', async () => {
    const result = await access.writeFile(path.join(outsideDir, 'nothing.txt'), 'x', 1);
    expect(result).toEqual({
      ok: false,
      error: 'Access denied: the file is outside the selected project folder.',
    });
  });

  it('refuses a folder', async () => {
    const dir = path.join(projectDir, 'src');
    const result = await access.writeFile(dir, 'x', (await fs.stat(dir)).mtimeMs);
    expect(result.ok).toBe(false);
  });

  it('round-trips a byte order mark and CRLF line endings byte for byte', async () => {
    const file = path.join(projectDir, 'windows.txt');
    const original = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('line one\r\nline two — ünïcödé\r\n', 'utf8'),
    ]);
    await fs.writeFile(file, original);

    const read = valueOf(await access.readFile(file));
    expect(read.content.startsWith('﻿')).toBe(true);
    expect(valueOf(await access.writeFile(file, read.content, read.mtimeMs)).status).toBe('saved');
    expect((await fs.readFile(file)).equals(original)).toBe(true);
  });

  it('rejects malformed payloads without touching the file', async () => {
    const file = path.join(projectDir, 'src', 'index.ts');
    const { mtimeMs } = await fs.stat(file);
    expect(await access.writeFile('', 'x', mtimeMs)).toEqual({
      ok: false,
      error: 'Invalid file path.',
    });
    expect(await access.writeFile(file, 7, mtimeMs)).toEqual({
      ok: false,
      error: 'Invalid file content.',
    });
    for (const bad of [undefined, '123', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await access.writeFile(file, 'x', bad)).toEqual({
        ok: false,
        error: 'Invalid modification time.',
      });
    }
    expect((await access.writeFile(file, 'a'.repeat(MAX_TEXT_FILE_BYTES + 1), mtimeMs)).ok).toBe(
      false,
    );
    expect(await fs.readFile(file, 'utf8')).toBe('export const a = 1;\n');
  });
});
