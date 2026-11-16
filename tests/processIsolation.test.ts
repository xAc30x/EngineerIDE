import { promises as fs } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces guardrail 1 in CLAUDE.md: renderer code in `src/` must not import
 * Electron or Node built-in modules. OS access goes through `window.electronAPI`.
 */

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
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

function findForbiddenImports(source: string): string[] {
  return [...source.matchAll(MODULE_SPECIFIER_PATTERN)]
    .map((match) => match[2])
    .filter((specifier): specifier is string => specifier !== undefined)
    .filter(isForbiddenModule);
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
});
