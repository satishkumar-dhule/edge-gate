/**
 * ============================================================================
 * ZERO-DYNAMIC-IMPORT MONACO EDITOR BOOTSTRAP
 * ============================================================================
 * Imports Monaco's standalone `monaco-editor/editor` API + core interactive
 * contributions + static Monarch language definitions directly instead of the
 * monolithic `monaco-editor` root entrypoint.
 *
 * Why: The root `monaco-editor` package registers 80+ lazy language loaders
 * (`() => import('./typescript.js')`, `import('./ini.js')`, `import('./tsMode.js')`)
 * which Vite splits into hashed `.vite/deps/*` chunks that fail with
 * `TypeError: Failed to fetch dynamically imported module` across dev reloads.
 * Static registration eliminates every dynamic chunk fetch permanently while
 * preserving full syntax highlighting and editor shortcuts across all workspace files.
 * ============================================================================
 */

import * as monaco from 'monaco-editor/editor';
import { loader } from '@monaco-editor/react';

// Core editor widgets & commands (100% static ESM, zero dynamic imports)
import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/lineSelection/browser/lineSelection.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';

// Static Monarch language definitions (zero lazy `import()` calls)
import * as tsLang from 'monaco-editor/languages/definitions/typescript/typescript.js';
import * as jsLang from 'monaco-editor/languages/definitions/javascript/javascript.js';
import * as hclLang from 'monaco-editor/languages/definitions/hcl/hcl.js';
import * as cssLang from 'monaco-editor/languages/definitions/css/css.js';
import * as scssLang from 'monaco-editor/languages/definitions/scss/scss.js';
import * as lessLang from 'monaco-editor/languages/definitions/less/less.js';
import * as htmlLang from 'monaco-editor/languages/definitions/html/html.js';
import * as mdLang from 'monaco-editor/languages/definitions/markdown/markdown.js';
import * as yamlLang from 'monaco-editor/languages/definitions/yaml/yaml.js';
import * as shellLang from 'monaco-editor/languages/definitions/shell/shell.js';
import * as xmlLang from 'monaco-editor/languages/definitions/xml/xml.js';
import * as sqlLang from 'monaco-editor/languages/definitions/sql/sql.js';
import * as iniLang from 'monaco-editor/languages/definitions/ini/ini.js';
import * as dockerLang from 'monaco-editor/languages/definitions/dockerfile/dockerfile.js';

const JSON_CONF: monaco.languages.LanguageConfiguration = {
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
  ],
};

const JSON_MONARCH: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.json',
  tokenizer: {
    root: [
      [/[{}[\]]/, '@brackets'],
      [/[:,]/, 'delimiter'],
      [/"(?:\\.|[^"\\])*"(?=\s*:)/, 'string.key.json'],
      [/"(?:\\.|[^"\\])*"/, 'string.value.json'],
      [/\b(?:true|false|null)\b/, 'keyword.json'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number.json'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment'],
    ],
  },
};

interface StaticLangSpec {
  id: string;
  extensions?: string[];
  aliases?: string[];
  conf: monaco.languages.LanguageConfiguration;
  language: monaco.languages.IMonarchLanguage;
}

const STATIC_LANGUAGES: StaticLangSpec[] = [
  { id: 'typescript', extensions: ['.ts', '.tsx', '.mts', '.cts'], aliases: ['TypeScript', 'ts'], conf: tsLang.conf, language: tsLang.language },
  { id: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], aliases: ['JavaScript', 'js'], conf: jsLang.conf, language: jsLang.language },
  { id: 'json', extensions: ['.json', '.jsonc'], aliases: ['JSON', 'json'], conf: JSON_CONF, language: JSON_MONARCH },
  { id: 'hcl', extensions: ['.tf', '.tfvars', '.hcl'], aliases: ['Terraform', 'hcl'], conf: hclLang.conf, language: hclLang.language },
  { id: 'css', extensions: ['.css'], aliases: ['CSS', 'css'], conf: cssLang.conf, language: cssLang.language },
  { id: 'scss', extensions: ['.scss'], aliases: ['SCSS', 'scss'], conf: scssLang.conf, language: scssLang.language },
  { id: 'less', extensions: ['.less'], aliases: ['LESS', 'less'], conf: lessLang.conf, language: lessLang.language },
  { id: 'html', extensions: ['.html', '.htm', '.svg'], aliases: ['HTML', 'html'], conf: htmlLang.conf, language: htmlLang.language },
  { id: 'markdown', extensions: ['.md', '.mdx'], aliases: ['Markdown', 'md'], conf: mdLang.conf, language: mdLang.language },
  { id: 'yaml', extensions: ['.yml', '.yaml'], aliases: ['YAML', 'yaml'], conf: yamlLang.conf, language: yamlLang.language },
  { id: 'shell', extensions: ['.sh', '.bash', '.zsh', '.mk'], aliases: ['Shell', 'sh'], conf: shellLang.conf, language: shellLang.language },
  { id: 'xml', extensions: ['.xml'], aliases: ['XML', 'xml'], conf: xmlLang.conf, language: xmlLang.language },
  { id: 'sql', extensions: ['.sql'], aliases: ['SQL', 'sql'], conf: sqlLang.conf, language: sqlLang.language },
  { id: 'ini', extensions: ['.ini', '.env', '.conf', '.toml', '.properties'], aliases: ['INI', 'ini'], conf: iniLang.conf, language: iniLang.language },
  { id: 'dockerfile', extensions: ['.dockerfile'], aliases: ['Dockerfile', 'dockerfile'], conf: dockerLang.conf, language: dockerLang.language },
];

let initialized = false;

export function ensureStaticMonacoConfigured(): typeof monaco {
  if (typeof window !== 'undefined' && !initialized) {
    initialized = true;
    const registered = new Set(
      monaco.languages.getLanguages().map((lang: { id: string }) => lang.id)
    );
    for (const spec of STATIC_LANGUAGES) {
      if (!registered.has(spec.id)) {
        monaco.languages.register({
          id: spec.id,
          extensions: spec.extensions,
          aliases: spec.aliases,
        });
      }
      monaco.languages.setLanguageConfiguration(spec.id, spec.conf);
      monaco.languages.setMonarchTokensProvider(spec.id, spec.language);
    }
    loader.config({ monaco });
  }
  return monaco;
}

export { monaco };
