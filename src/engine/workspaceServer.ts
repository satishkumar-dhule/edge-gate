/**
 * ============================================================================
 * WORKSPACE FILESYSTEM SERVICE (SERVER-ONLY NODE MODULE)
 * ============================================================================
 * Backs the embedded VS Code Web IDE Explorer, Editor, Save, and Search APIs
 * with strict path-traversal protection scoped to the applet root directory.
 * ============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  detectMonacoLanguage,
  isBinaryWorkspaceFile,
  isIgnoredWorkspaceSegment,
  sanitizeWorkspacePath,
  type WorkspaceEntry,
} from './workspacePaths';

export interface WorkspaceFilePayload {
  path: string;
  content: string;
  sizeBytes: number;
  mtimeMs: number;
  language: string;
}

export interface WorkspaceSearchHit {
  path: string;
  line: number;
  preview: string;
}

const MAX_EDITABLE_FILE_BYTES = 1_500_000;
const MAX_TREE_ENTRIES = 600;
const MAX_SEARCH_HITS = 80;

function resolveWithinRoot(rootDir: string, normalizedRelPath: string): string {
  const realRoot = fs.realpathSync(rootDir);
  const candidate = path.resolve(realRoot, normalizedRelPath);
  if (candidate !== realRoot && !candidate.startsWith(realRoot + path.sep)) {
    throw new Error('Resolved path escapes workspace root');
  }
  return candidate;
}

export function listWorkspaceTree(rootDir: string): WorkspaceEntry[] {
  let visited = 0;

  const walk = (absDir: string, relPrefix: string, depth: number): WorkspaceEntry[] => {
    if (depth > 5 || visited >= MAX_TREE_ENTRIES) return [];

    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }

    // Sort: directories first, then dotfiles (.env), then alphabetical
    dirents.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const entries: WorkspaceEntry[] = [];
    for (const d of dirents) {
      if (visited >= MAX_TREE_ENTRIES) break;
      if (isIgnoredWorkspaceSegment(d.name)) continue;

      const relPath = relPrefix ? `${relPrefix}/${d.name}` : d.name;
      const absChild = path.join(absDir, d.name);

      if (d.isDirectory()) {
        // Keep public/screenshots concise so hundreds of test snapshots don't flood sidebar
        if (relPath === 'public/screenshots') {
          entries.push({
            name: d.name,
            path: relPath,
            type: 'directory',
            children: [],
          });
          visited += 1;
          continue;
        }
        visited += 1;
        const children = walk(absChild, relPath, depth + 1);
        entries.push({
          name: d.name,
          path: relPath,
          type: 'directory',
          children,
        });
      } else if (d.isFile()) {
        visited += 1;
        let sizeBytes = 0;
        try {
          sizeBytes = fs.statSync(absChild).size;
        } catch {
          sizeBytes = 0;
        }
        entries.push({
          name: d.name,
          path: relPath,
          type: 'file',
          sizeBytes,
          isBinary: isBinaryWorkspaceFile(relPath),
        });
      }
    }
    return entries;
  };

  return walk(rootDir, '', 0);
}

export function readWorkspaceFile(rootDir: string, rawPath: string): WorkspaceFilePayload {
  const check = sanitizeWorkspacePath(rawPath);
  if (!check.valid) {
    throw new Error(check.reason || 'Invalid workspace path');
  }
  if (isBinaryWorkspaceFile(check.normalized)) {
    throw new Error(`Binary file "${check.normalized}" cannot be opened in the text editor`);
  }

  const absPath = resolveWithinRoot(rootDir, check.normalized);
  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${check.normalized}`);
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${check.normalized}`);
  }
  if (stat.size > MAX_EDITABLE_FILE_BYTES) {
    throw new Error(
      `File "${check.normalized}" (${(stat.size / 1024).toFixed(0)} KB) exceeds 1.5 MB editor limit`
    );
  }

  const realFile = fs.realpathSync(absPath);
  const realRoot = fs.realpathSync(rootDir);
  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
    throw new Error('Symlink target escapes workspace root');
  }

  const content = fs.readFileSync(realFile, 'utf8');
  return {
    path: check.normalized,
    content,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    language: detectMonacoLanguage(check.normalized),
  };
}

export function writeWorkspaceFile(
  rootDir: string,
  rawPath: string,
  content: string,
  options: { createOnly?: boolean } = {}
): { path: string; sizeBytes: number; mtimeMs: number; language: string } {
  const check = sanitizeWorkspacePath(rawPath);
  if (!check.valid) {
    throw new Error(check.reason || 'Invalid workspace path');
  }
  if (isBinaryWorkspaceFile(check.normalized)) {
    throw new Error(`Cannot write binary file "${check.normalized}" from text editor`);
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_BYTES) {
    throw new Error('File content exceeds 1.5 MB editor limit');
  }

  const absPath = resolveWithinRoot(rootDir, check.normalized);
  if (options.createOnly && fs.existsSync(absPath)) {
    throw new Error(`File already exists: ${check.normalized}`);
  }

  const parentDir = path.dirname(absPath);
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(absPath, content, 'utf8');

  const stat = fs.statSync(absPath);
  return {
    path: check.normalized,
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
    language: detectMonacoLanguage(check.normalized),
  };
}

export function searchWorkspaceFiles(
  rootDir: string,
  rawQuery: string
): WorkspaceSearchHit[] {
  const query = String(rawQuery ?? '').trim().toLowerCase();
  if (!query || query.length < 2) return [];

  const hits: WorkspaceSearchHit[] = [];

  const scan = (absDir: string, relPrefix: string, depth: number) => {
    if (depth > 5 || hits.length >= MAX_SEARCH_HITS) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const d of dirents) {
      if (hits.length >= MAX_SEARCH_HITS) break;
      if (isIgnoredWorkspaceSegment(d.name)) continue;
      const relPath = relPrefix ? `${relPrefix}/${d.name}` : d.name;
      const absChild = path.join(absDir, d.name);

      if (d.isDirectory()) {
        if (relPath === 'public/screenshots') continue;
        scan(absChild, relPath, depth + 1);
      } else if (d.isFile() && !isBinaryWorkspaceFile(relPath)) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(absChild);
        } catch {
          continue;
        }
        if (stat.size > 400_000) continue;
        try {
          const text = fs.readFileSync(absChild, 'utf8');
          if (!text.toLowerCase().includes(query)) continue;
          const lines = text.split(/\r?\n/);
          for (let idx = 0; idx < lines.length; idx++) {
            if (lines[idx].toLowerCase().includes(query)) {
              hits.push({
                path: relPath,
                line: idx + 1,
                preview: lines[idx].trim().slice(0, 140),
              });
              if (hits.length >= MAX_SEARCH_HITS) break;
            }
          }
        } catch {
          // ignore unreadable files
        }
      }
    }
  };

  scan(rootDir, '', 0);
  return hits;
}
