/**
 * ============================================================================
 * WORKSPACE PATH & MONACO LANGUAGE ENGINE (PURE ISOMORPHIC LOGIC)
 * ============================================================================
 * Pure path-normalization, security boundary checks, and VS Code / Monaco
 * language detection for the embedded VS Code Web IDE.
 * Zero Node built-in imports so client bundles stay 100% browser-safe.
 * ============================================================================
 */

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
  isBinary?: boolean;
  children?: WorkspaceEntry[];
}

export interface WorkspaceQuickFile {
  path: string;
  label: string;
  description: string;
}

export const CURATED_WORKSPACE_QUICK_FILES: WorkspaceQuickFile[] = [
  {
    path: '.env',
    label: '.env',
    description: 'AWS credentials & deployment target environment variables',
  },
  {
    path: 'Makefile',
    label: 'Makefile',
    description: 'make deploy / make deply / make verify automation targets',
  },
  {
    path: 'src/config/template.config.ts',
    label: 'template.config.ts',
    description: 'Master property, edge IP, and test suite configuration',
  },
  {
    path: 'infra/terraform/main.tf',
    label: 'main.tf',
    description: 'Terraform CloudFront, S3, DynamoDB, Synthetics & Lambda stack',
  },
  {
    path: 'infra/terraform/terraform.tfvars',
    label: 'terraform.tfvars',
    description: 'Terraform deployment variable overrides',
  },
  {
    path: 'scripts/deploy-aws-portal.ts',
    label: 'deploy-aws-portal.ts',
    description: 'AWS Terraform, S3 sync & CloudFront invalidation orchestrator',
  },
  {
    path: 'package.json',
    label: 'package.json',
    description: 'pnpm workspace dependencies and scripts',
  },
];

const BLOCKED_ROOT_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.playwright-cli',
  '.vite',
  '.next',
]);

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'pdf',
  'zip',
  'tar',
  'gz',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'mp4',
  'webm',
  'mp3',
  'wav',
  'sqlite',
  'db',
]);

/**
 * Validates and normalizes a workspace-relative path, blocking directory
 * traversal (`..`), absolute/Windows drive paths, null bytes, and internal
 * build/VCS folders (`node_modules`, `.git`, `dist`).
 */
export function sanitizeWorkspacePath(rawPath: string): {
  valid: boolean;
  normalized: string;
  reason?: string;
} {
  const input = String(rawPath ?? '').trim();
  if (!input) {
    return { valid: false, normalized: '', reason: 'Path must not be empty' };
  }
  if (input.includes('\0')) {
    return { valid: false, normalized: '', reason: 'Path contains null byte' };
  }
  if (/^[a-zA-Z]:/.test(input) || input.includes('\\')) {
    return { valid: false, normalized: '', reason: 'Backslashes and drive letters are not allowed' };
  }

  const stripped = input.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const segments = stripped.split('/').filter((seg) => seg.length > 0 && seg !== '.');

  if (segments.length === 0) {
    return { valid: false, normalized: '', reason: 'Path resolves to workspace root' };
  }

  for (const seg of segments) {
    if (seg === '..') {
      return { valid: false, normalized: '', reason: 'Parent directory traversal (..) is blocked' };
    }
    if (BLOCKED_ROOT_SEGMENTS.has(seg)) {
      return {
        valid: false,
        normalized: '',
        reason: `Access to internal directory "${seg}" is restricted`,
      };
    }
  }

  return {
    valid: true,
    normalized: segments.join('/'),
  };
}

/**
 * Checks whether a directory or file segment should be excluded from Explorer tree & Search.
 */
export function isIgnoredWorkspaceSegment(name: string): boolean {
  return BLOCKED_ROOT_SEGMENTS.has(name);
}

/**
 * Detects whether a file path points to a binary asset unsuitable for text editing.
 */
export function isBinaryWorkspaceFile(filePath: string): boolean {
  const clean = String(filePath || '').toLowerCase();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot < 0) return false;
  const ext = clean.slice(lastDot + 1);
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Maps a workspace file path or filename to a built-in Monaco Editor language ID.
 */
export function detectMonacoLanguage(filePath: string): string {
  const clean = String(filePath || '').trim();
  const base = clean.split('/').pop()?.toLowerCase() || '';

  if (base === 'makefile' || base.endsWith('.mk')) return 'shell';
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile';
  if (base === '.env' || base.startsWith('.env.')) return 'ini';
  if (base === '.gitignore' || base === '.dockerignore') return 'ini';

  const lastDot = base.lastIndexOf('.');
  const ext = lastDot >= 0 ? base.slice(lastDot + 1) : '';

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
    case 'jsonc':
      return 'json';
    case 'tf':
    case 'tfvars':
    case 'hcl':
      return 'hcl';
    case 'css':
    case 'scss':
    case 'less':
      return ext;
    case 'html':
    case 'htm':
    case 'svg':
      return 'html';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'xml':
      return 'xml';
    case 'sql':
      return 'sql';
    case 'ini':
    case 'conf':
    case 'toml':
      return 'ini';
    default:
      return 'plaintext';
  }
}
