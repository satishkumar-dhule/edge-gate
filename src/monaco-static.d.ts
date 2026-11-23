declare module 'monaco-editor/editor' {
  export * from 'monaco-editor';
}

declare module 'monaco-editor/languages/definitions/*' {
  import type * as monaco from 'monaco-editor';
  export const conf: monaco.languages.LanguageConfiguration;
  export const language: monaco.languages.IMonarchLanguage;
}

declare module 'monaco-editor/editor/contrib/*' {}
declare module 'monaco-editor/editor/browser/*' {}
