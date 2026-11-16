import { promises as fs } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces guardrail 1 and the import direction in CLAUDE.md:
 * - `src/` and `shared/` must not import Electron or Node built-in modules.
 *   OS access goes through `window.electronAPI`.
 * - `shared/` imports only from `shared/`.
 * - `src/` never imports from `electron/`, and `electron/` never from `src/`.
 */

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const SHARED_DIR = path.join(ROOT_DIR, 'shared');
const ELECTRON_DIR = path.join(ROOT_DIR, 'electron');
const SOURCE_FILE_PATTERN = /\.(ts|tsx)$/;

// Matches the module name in `import … from 'x'`, `import 'x'`, `import('x')`,
// `export … from 'x'`, and `require('x')`.
const MODULE_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"]+)\1/g;

const NODE_BUILTINS = new Set(builtinModules);

function isForbiddenModule(specifier: string): boolean {
  if (specifier.startsWith('node:')) {
    return true;
  }
  const packageName = specifier.split('/')[0] ?? specifier;
  return packageName === 'electron' || NODE_BUILTINS.has(packageName);
}

function findImports(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER_PATTERN)]
    .map((match) => match[2])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function findForbiddenImports(source: string): string[] {
  return findImports(source).filter(isForbiddenModule);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/** True when a relative import in `file` points at a module inside `directory`. */
function importsFrom(file: string, specifier: string, directory: string): boolean {
  if (!isRelative(specifier)) {
    return false;
  }
  const target = path.resolve(path.dirname(file), specifier);
  return target === directory || target.startsWith(directory + path.sep);
}

/** Lists `file imports "specifier"` for every import in `directory` that `isViolation` flags. */
async function findViolations(
  directory: string,
  isViolation: (file: string, specifier: string) => boolean,
): Promise<string[]> {
  const files = await listSourceFiles(directory);
  expect(files.length).toBeGreaterThan(0);

  const violations: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const specifier of findImports(source)) {
      if (isViolation(file, specifier)) {
        violations.push(`${path.relative(ROOT_DIR, file)} imports "${specifier}"`);
      }
    }
  }
  return violations;
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSourceFiles(entryPath);
      }
      return SOURCE_FILE_PATTERN.test(entry.name) ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

describe('process isolation', () => {
  it('detects the import forms it is meant to catch', () => {
    expect(findForbiddenImports("import { ipcRenderer } from 'electron';")).toEqual(['electron']);
    expect(findForbiddenImports('import fs from "fs";')).toEqual(['fs']);
    expect(findForbiddenImports("import { join } from 'node:path';")).toEqual(['node:path']);
    expect(findForbiddenImports("import { readFile } from 'fs/promises';")).toEqual([
      'fs/promises',
    ]);
    expect(findForbiddenImports("const cp = require('child_process');")).toEqual(['child_process']);
    expect(findForbiddenImports("const os = await import('os');")).toEqual(['os']);
    expect(findForbiddenImports("import 'path';")).toEqual(['path']);
    expect(findForbiddenImports("export { sep } from 'path';")).toEqual(['path']);
  });

  it('accepts renderer-safe imports', () => {
    expect(findForbiddenImports("import { create } from 'zustand';")).toEqual([]);
    expect(findForbiddenImports("import type { Thread } from '../types';")).toEqual([]);
    expect(findForbiddenImports("import { useState } from 'react';")).toEqual([]);
  });

  it('finds no Electron or Node built-in imports in src/', async () => {
    const files = await listSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      for (const specifier of findForbiddenImports(source)) {
        violations.push(`${path.relative(SRC_DIR, file)} imports "${specifier}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('recognises which folder a relative import points at', () => {
    const file = path.join(SRC_DIR, 'store', 'useAppStore.ts');
    expect(importsFrom(file, '../../shared/appState', SHARED_DIR)).toBe(true);
    expect(importsFrom(file, '../../electron/main', ELECTRON_DIR)).toBe(true);
    expect(importsFrom(file, '../lib/bridge', ELECTRON_DIR)).toBe(false);
    expect(importsFrom(file, 'zustand', SHARED_DIR)).toBe(false);
  });

  it('finds no Electron or Node built-in imports in shared/', async () => {
    const violations = await findViolations(SHARED_DIR, (_file, specifier) =>
      isForbiddenModule(specifier),
    );
    expect(violations).toEqual([]);
  });

  it('finds only imports from shared/ inside shared/', async () => {
    const violations = await findViolations(
      SHARED_DIR,
      (file, specifier) => !importsFrom(file, specifier, SHARED_DIR),
    );
    expect(violations).toEqual([]);
  });

  it('finds no imports from electron/ in src/', async () => {
    const violations = await findViolations(SRC_DIR, (file, specifier) =>
      importsFrom(file, specifier, ELECTRON_DIR),
    );
    expect(violations).toEqual([]);
  });

  it('finds no imports from src/ in electron/', async () => {
    const violations = await findViolations(ELECTRON_DIR, (file, specifier) =>
      importsFrom(file, specifier, SRC_DIR),
    );
    expect(violations).toEqual([]);
  });
});
