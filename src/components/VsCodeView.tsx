import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { ensureStaticMonacoConfigured, monaco } from '../engine/monacoSetup';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  PanelLeft,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppConfig, ComparisonItem } from '../engine/types';
import { TemplateConfig, TestCaseDefinition, resolvePropertyHostname } from '../config/template.config';
import {
  CURATED_WORKSPACE_QUICK_FILES,
  detectMonacoLanguage,
  type WorkspaceEntry,
} from '../engine/workspacePaths';
import {
  evaluatePluginPipeline,
  generateAiAgentAdaptationBundle,
  generateOneShotAdaptationPrompt,
} from '../engine/pluginRegistry';
import {
  generateDefaultScriptForTest,
  getScriptEngineMeta,
  inferScriptEngineForTest,
} from '../engine/scriptTemplates';
import type { ComputeHostInfo } from '../engine/computeShell';
import { ComputePtyTerminal, type ComputePtyTerminalHandle } from './ComputePtyTerminal';

if (typeof window !== 'undefined') {
  ensureStaticMonacoConfigured();
}

interface EditorTab {
  path: string;
  label: string;
  content: string;
  savedContent: string;
  language: string;
  isVirtual?: boolean;
  loading?: boolean;
}

interface SearchHit {
  path: string;
  line: number;
  preview: string;
}

export interface VsCodeViewProps {
  theme: 'light' | 'dark';
  activeApp: AppConfig | undefined;
  activeSuite: TestCaseDefinition[];
  liveTemplateConfig: TemplateConfig;
  selectedItem: ComparisonItem | undefined;
  onSaveProperty: (updated: AppConfig) => void;
  onSaveSuite: (appId: string, suite: TestCaseDefinition[]) => void;
}

export const VsCodeView: React.FC<VsCodeViewProps> = ({
  theme,
  activeApp,
  activeSuite,
  liveTemplateConfig,
  selectedItem,
  onSaveProperty,
  onSaveSuite,
}) => {
  const [activityTab, setActivityTab] = useState<'explorer' | 'search' | 'plugins'>('explorer');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const [treeEntries, setTreeEntries] = useState<WorkspaceEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({
    src: true,
    'src/config': true,
    'src/engine': true,
    infra: true,
    'infra/terraform': true,
  });

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string>('');
  const [savingPath, setSavingPath] = useState<string | null>(null);

  const [newFileMode, setNewFileMode] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const [computeInfo, setComputeInfo] = useState<ComputeHostInfo | null>(null);
  const [scriptRunning, setScriptRunning] = useState(false);
  const [editorMode, setEditorMode] = useState<'monaco' | 'plain'>('monaco');
  const [lastSavedMap, setLastSavedMap] = useState<Record<string, string>>({});
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null);
  const ptyTerminalRef = useRef<ComputePtyTerminalHandle | null>(null);
  const handleSaveRef = useRef<() => void>(() => undefined);

  const appId = activeApp?.id || 'www';

  const virtualDocs = useMemo(() => {
    const suitePath = `live://${appId}.suite.json`;
    const envsPath = `live://${appId}.envs.json`;
    const promptPath = `live://one-shot-adaptation.md`;
    const envIds = Array.from(
      new Set(liveTemplateConfig.properties.flatMap((p) => p.envs.map((e) => e.id)))
    );
    const promptText = generateOneShotAdaptationPrompt({
      organizationName: liveTemplateConfig.branding.controlPlaneTitle,
      primaryDomain: liveTemplateConfig.branding.defaultDomain,
      cdnProvider: 'Akamai Edge',
      stagingEdgeSuffix: liveTemplateConfig.networks.staging.edgeSuffix,
      stagingEdgeIp: liveTemplateConfig.networks.staging.defaultEdgeIp,
      prodEdgeSuffix: liveTemplateConfig.networks.prod.edgeSuffix,
      prodEdgeIp: liveTemplateConfig.networks.prod.defaultEdgeIp,
      awsRegion: liveTemplateConfig.infrastructure.awsRegion,
      s3Bucket: liveTemplateConfig.infrastructure.s3Bucket,
      propertiesCsv: liveTemplateConfig.properties.map((p) => p.id).join(', '),
      environmentsCsv: envIds.join(', '),
    });
    const docs: Record<string, { path: string; label: string; language: string; content: string; testId?: string }> = {
      [suitePath]: {
        path: suitePath,
        label: `${appId}.suite.json (Live)`,
        language: 'json',
        content: JSON.stringify(activeSuite, null, 2),
      },
      [envsPath]: {
        path: envsPath,
        label: `${appId}.envs.json (Live)`,
        language: 'json',
        content: JSON.stringify(activeApp?.envs || [], null, 2),
      },
      [promptPath]: {
        path: promptPath,
        label: 'AI-Adaptation-Prompt.md',
        language: 'markdown',
        content: promptText,
      },
    };
    for (const tc of activeSuite) {
      const eng = inferScriptEngineForTest(tc);
      const meta = getScriptEngineMeta(eng);
      const scriptPath = `live://script/${appId}/${tc.id}`;
      docs[scriptPath] = {
        path: scriptPath,
        label: `${tc.id}${meta.fileExt}`,
        language: meta.language,
        content: tc.customScript?.trim()
          ? tc.customScript
          : generateDefaultScriptForTest(tc, eng),
        testId: tc.id,
      };
    }
    return docs;
  }, [appId, activeSuite, activeApp?.envs, liveTemplateConfig]);

  const pluginReport = useMemo(() => {
    const activeCase =
      activeSuite.find((tc) => tc.id === selectedItem?.testId) || activeSuite[0];
    const cand = selectedItem?.candidateResult;
    const base = selectedItem?.baselineResult;
    const toHeaderRecord = (raw?: Record<string, string | undefined>): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!raw) return out;
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    };
    return evaluatePluginPipeline(
      {
        testId: selectedItem?.testId || activeCase?.id || 'T01',
        testName: selectedItem?.testName || activeCase?.name || 'Home Page',
        path: activeCase?.path || '/',
        candidateTarget: `${appId}.prod.staging`,
        baselineTarget: `${appId}.prod.prod`,
        candidateStatus: cand?.actualStatus ?? 200,
        baselineStatus: base?.actualStatus ?? 200,
        candidateLatencyMs: cand?.durationMs ?? 85,
        baselineLatencyMs: base?.durationMs ?? 72,
        candidateHeaders: toHeaderRecord(cand?.capturedHeaders),
        baselineHeaders: toHeaderRecord(base?.capturedHeaders),
        candidateCookies: cand?.capturedCookies || {},
        baselineCookies: base?.capturedCookies || {},
        pixelDiffPercent: selectedItem?.visualResult?.pixelDiffPercent ?? 0,
      },
      liveTemplateConfig
    );
  }, [appId, selectedItem, activeSuite, liveTemplateConfig]);

  const adaptationBundle = useMemo(
    () => generateAiAgentAdaptationBundle(liveTemplateConfig),
    [liveTemplateConfig]
  );

  const loadTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const res = await fetch('/api/v1/workspace/tree');
      if (res.ok) {
        const data = (await res.json()) as { entries?: WorkspaceEntry[] };
        setTreeEntries(Array.isArray(data.entries) ? data.entries : []);
      }
    } catch {
      // Ignore offline errors cleanly
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const openFile = useCallback(
    async (filePath: string) => {
      setMobileSidebarOpen(false);
      const existing = tabs.find((t) => t.path === filePath);
      if (existing) {
        setActiveTabPath(filePath);
        return;
      }

      if (filePath.startsWith('live://')) {
        const vdoc = virtualDocs[filePath];
        if (!vdoc) return;
        setTabs((prev) => [
          ...prev,
          {
            path: vdoc.path,
            label: vdoc.label,
            content: vdoc.content,
            savedContent: vdoc.content,
            language: vdoc.language,
            isVirtual: true,
          },
        ]);
        setActiveTabPath(vdoc.path);
        return;
      }

      const label = filePath.split('/').pop() || filePath;
      setTabs((prev) => [
        ...prev,
        {
          path: filePath,
          label,
          content: '// Loading workspace file…',
          savedContent: '// Loading workspace file…',
          language: detectMonacoLanguage(filePath),
          loading: true,
        },
      ]);
      setActiveTabPath(filePath);

      try {
        const res = await fetch(
          `/api/v1/workspace/file?path=${encodeURIComponent(filePath)}`
        );
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as {
          path: string;
          content: string;
          language: string;
        };
        setTabs((prev) =>
          prev.map((t) =>
            t.path === filePath
              ? {
                  ...t,
                  content: payload.content,
                  savedContent: payload.content,
                  language: payload.language || detectMonacoLanguage(filePath),
                  loading: false,
                }
              : t
          )
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTabs((prev) =>
          prev.map((t) =>
            t.path === filePath
              ? {
                  ...t,
                  content: `// Unable to load ${filePath}: ${msg}`,
                  savedContent: `// Unable to load ${filePath}: ${msg}`,
                  loading: false,
                }
              : t
          )
        );
        toast.error(`Failed to open ${filePath}: ${msg}`);
      }
    },
    [tabs, virtualDocs]
  );

  const loadComputeInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/terminal/info');
      if (!res.ok) return;
      const info = (await res.json()) as ComputeHostInfo;
      setComputeInfo(info);
    } catch {
      // ignore offline telemetry fetch
    }
  }, []);

  useEffect(() => {
    loadTree();
    loadComputeInfo();
  }, [loadTree, loadComputeInfo]);

  useEffect(() => {
    if (tabs.length === 0) {
      openFile('src/config/template.config.ts');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.path === activeTabPath) || tabs[0],
    [tabs, activeTabPath]
  );

  const isDirty = Boolean(activeTab && activeTab.content !== activeTab.savedContent);

  const handleSaveTab = useCallback(
    async (tabToSave?: EditorTab) => {
      const target = tabToSave || activeTab;
      if (!target || target.loading) return;

      if (target.path.startsWith('live://')) {
        if (target.path.endsWith('.suite.json')) {
          try {
            const parsed = JSON.parse(target.content) as TestCaseDefinition[];
            if (!Array.isArray(parsed) || parsed.length === 0) {
              throw new Error('Suite JSON must be a non-empty array of test cases');
            }
            onSaveSuite(appId, parsed);
            setTabs((prev) =>
              prev.map((t) =>
                t.path === target.path ? { ...t, savedContent: target.content } : t
              )
            );
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Invalid suite JSON');
          }
          return;
        }
        if (target.path.endsWith('.envs.json') && activeApp) {
          try {
            const parsed = JSON.parse(target.content) as AppConfig['envs'];
            if (!Array.isArray(parsed) || parsed.length === 0) {
              throw new Error('Environments JSON must be a non-empty array');
            }
            onSaveProperty({ ...activeApp, envs: parsed });
            setTabs((prev) =>
              prev.map((t) =>
                t.path === target.path ? { ...t, savedContent: target.content } : t
              )
            );
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Invalid envs JSON');
          }
          return;
        }
        if (target.path.startsWith(`live://script/${appId}/`)) {
          const testId = target.path.split('/').pop() || '';
          const updatedSuite = activeSuite.map((tc) =>
            tc.id === testId
              ? {
                  ...tc,
                  scriptEngine: tc.scriptEngine || inferScriptEngineForTest(tc),
                  customScript: target.content,
                }
              : tc
          );
          onSaveSuite(appId, updatedSuite);
          setTabs((prev) =>
            prev.map((t) =>
              t.path === target.path ? { ...t, savedContent: target.content } : t
            )
          );
          toast.success(`Saved script for ${testId}`);
          return;
        }
        toast.info('Read-only generated specification — copy to clipboard');
        return;
      }

      setSavingPath(target.path);
      try {
        const res = await fetch('/api/v1/workspace/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: target.path, content: target.content }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        setTabs((prev) =>
          prev.map((t) =>
            t.path === target.path ? { ...t, savedContent: target.content } : t
          )
        );
        const ts = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        setLastSavedMap((prev) => ({ ...prev, [target.path]: ts }));
        toast.success(`Saved ${target.path} to disk`);
        loadTree();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSavingPath(null);
      }
    },
    [activeTab, appId, activeApp, onSaveProperty, onSaveSuite, loadTree]
  );

  useEffect(() => {
    handleSaveRef.current = () => {
      if (activeTab && (activeTab.content !== activeTab.savedContent || activeTab.isVirtual)) {
        handleSaveTab(activeTab);
      }
    };
  }, [activeTab, handleSaveTab]);

  const handleRevertTab = (tab: EditorTab) => {
    setTabs((prev) =>
      prev.map((t) => (t.path === tab.path ? { ...t, content: t.savedContent } : t))
    );
    toast.info(`Reverted unsaved changes in ${tab.label}`);
  };

  const handleReloadTabFromDisk = async (tab: EditorTab) => {
    if (tab.isVirtual || tab.path.startsWith('live://')) return;
    try {
      const res = await fetch(`/api/v1/workspace/file?path=${encodeURIComponent(tab.path)}`);
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { content: string };
      setTabs((prev) =>
        prev.map((t) =>
          t.path === tab.path
            ? { ...t, content: payload.content, savedContent: payload.content }
            : t
        )
      );
      toast.success(`Reloaded ${tab.path} from disk`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reload file');
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    try {
      const res = await fetch(
        `/api/v1/workspace/file?path=${encodeURIComponent(filePath)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setConfirmDeletePath(null);
      handleCloseTab(filePath);
      await loadTree();
      toast.success(`Deleted ${filePath}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  const handleCloseTab = (path: string) => {
    setConfirmDeletePath((cur) => (cur === path ? null : cur));
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        setActiveTabPath(next[next.length - 1]?.path || '');
      }
      return next;
    });
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newFilePath.trim();
    if (!cleaned) return;
    try {
      const res = await fetch('/api/v1/workspace/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: cleaned, content: '' }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setNewFileMode(false);
      setNewFilePath('');
      await loadTree();
      await openFile(cleaned);
      toast.success(`Created ${cleaned}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create file');
    }
  };

  const handleRunSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/v1/workspace/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = (await res.json()) as { hits?: SearchHit[] };
        setSearchHits(Array.isArray(data.hits) ? data.hits : []);
      }
    } finally {
      setSearching(false);
    }
  };

  const handleRunActiveScript = async () => {
    if (!activeTab || !activeTab.path.startsWith(`live://script/${appId}/`)) return;
    const testId = activeTab.path.split('/').pop() || 'T01';
    const tc = activeSuite.find((item) => item.id === testId) || activeSuite[0];
    const engine = tc?.scriptEngine || inferScriptEngineForTest(tc || { id: testId, name: testId, path: '/', expectedStatus: '200' });
    const hostname = tc?.targetHost || resolvePropertyHostname(appId, 'prod', liveTemplateConfig);
    const path = tc?.path?.startsWith('/') ? tc.path : `/${tc?.path || ''}`;
    const targetUrl = `https://${hostname}${path}`;

    setTerminalOpen(true);
    setScriptRunning(true);
    ptyTerminalRef.current?.writeNotice(
      `\x1b[36m$ run-script --engine=${engine} --test=${testId} ${targetUrl}\x1b[0m`
    );

    try {
      const res = await fetch('/api/v1/scripts/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: activeTab.content,
          engine,
          targetUrl,
          baseUrl: `https://${hostname}`,
          timeoutMs: tc?.scriptTimeoutMs || 15000,
          appId,
          testId,
          testName: tc?.name || testId,
          requestHeaders: tc?.requestHeaders,
        }),
      });
      const data = await res.json();
      const lines: string[] = [];
      lines.push(
        `[${data.passed ? 'PASS' : 'FAIL'}] engine=${data.engine || engine} mode=${data.executionMode || 'live'} duration=${data.durationMs ?? 0}ms`
      );
      if (data.pageTitle) {
        lines.push(`Page Title: ${data.pageTitle}`);
      }
      if (Array.isArray(data.stepLogs)) {
        for (const s of data.stepLogs) {
          lines.push(
            `  #${s.step} ${s.status?.toUpperCase?.() || 'PASS'} ${s.action} ${s.target} (${s.durationMs}ms)${s.detail ? ` — ${s.detail}` : ''}`
          );
        }
      }
      if (Array.isArray(data.consoleLogs) && data.consoleLogs.length > 0) {
        lines.push('--- Console Output ---');
        for (const log of data.consoleLogs) {
          lines.push(`  ${log}`);
        }
      }
      if (data.error) {
        lines.push(`[ERROR] ${data.error}`);
      }
      ptyTerminalRef.current?.writeNotice(lines.join('\r\n'));
      if (data.passed) {
        toast.success(`Script ${testId} passed (${data.durationMs}ms)`);
      } else {
        toast.error(`Script ${testId} failed: ${data.error || 'See terminal'}`);
      }
    } catch (err) {
      ptyTerminalRef.current?.writeNotice(
        `[error] ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setScriptRunning(false);
    }
  };

  const renderTreeNodes = (nodes: WorkspaceEntry[], depth = 0) => {
    const visibleNodes = nodes.filter((entry) => {
      if (
        entry.name === '.aistudio' ||
        entry.name === '.cache' ||
        entry.name === '.tempmediaStorage' ||
        entry.name === '.terraform' ||
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist'
      ) {
        return false;
      }
      if (entry.name.includes('.tfstate') || entry.name === '.terraform.lock.hcl') {
        return false;
      }
      return true;
    });
    return visibleNodes.map((entry) => {
      if (entry.type === 'directory') {
        const isOpen = Boolean(expandedDirs[entry.path]);
        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() =>
                setExpandedDirs((prev) => ({ ...prev, [entry.path]: !isOpen }))
              }
              style={{ paddingLeft: `${8 + depth * 12}px` }}
              className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs text-foreground/90 hover:bg-muted/70 cursor-pointer"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {isOpen ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate font-mono text-[11px]">{entry.name}</span>
            </button>
            {isOpen && entry.children && renderTreeNodes(entry.children, depth + 1)}
          </div>
        );
      }

      const active = activeTab?.path === entry.path;
      return (
        <button
          key={entry.path}
          type="button"
          disabled={entry.isBinary}
          onClick={() => openFile(entry.path)}
          style={{ paddingLeft: `${22 + depth * 12}px` }}
          className={`flex w-full items-center justify-between gap-2 py-1 pr-2 text-left text-[11px] font-mono cursor-pointer ${
            active
              ? 'bg-accent text-accent-foreground font-semibold shadow-[inset_2px_0_0_var(--bg-primary)]'
              : entry.isBinary
              ? 'text-muted-foreground/40 cursor-not-allowed'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          }`}
        >
          <span className="flex items-center gap-1.5 min-w-0">
            <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-75" />
            <span className="truncate">{entry.name}</span>
          </span>
        </button>
      );
    });
  };

  const sidebarPanel = (
    <div className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {activityTab === 'explorer'
            ? 'Explorer'
            : activityTab === 'search'
            ? 'Search'
            : 'Plugins & AI'}
        </span>
        {activityTab === 'explorer' && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setNewFileMode((v) => !v)}
              aria-label="New workspace file"
              title="New workspace file"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <FilePlus2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={loadTree}
              aria-label="Refresh workspace tree"
              title="Refresh workspace tree"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <RefreshCw className={`h-3 w-3 ${treeLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {activityTab === 'explorer' && (
        <div className="flex-1 overflow-y-auto">
          {newFileMode && (
            <form onSubmit={handleCreateFile} className="border-b border-border p-1.5 space-y-1">
              <input
                type="text"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="path/to/file.ts"
                className="h-6 w-full rounded border border-border bg-background px-1.5 font-mono text-[10px] text-foreground focus:border-primary focus:outline-none"
              />
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setNewFileMode(false)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          )}

          <div className="border-b border-border/70 py-1">
            <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Live App Config ({appId})
            </div>
            {Object.values(virtualDocs)
              .filter((vdoc) => !vdoc.path.startsWith('live://script/'))
              .map((vdoc) => {
                const active = activeTab?.path === vdoc.path;
                return (
                  <button
                    key={vdoc.path}
                    type="button"
                    onClick={() => openFile(vdoc.path)}
                    data-testid={`vscode-open-${vdoc.label}`}
                    className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left font-mono text-[11px] cursor-pointer ${
                      active
                        ? 'bg-accent text-accent-foreground font-semibold shadow-[inset_2px_0_0_var(--bg-primary)]'
                        : 'text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                    <span className="truncate">{vdoc.label}</span>
                  </button>
                );
              })}
          </div>

          <div className="border-b border-border/70 py-1">
            <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Test Scripts ({activeSuite.length})
            </div>
            <div className="max-h-40 overflow-y-auto">
              {activeSuite.map((tc) => {
                const scriptPath = `live://script/${appId}/${tc.id}`;
                const vdoc = virtualDocs[scriptPath];
                if (!vdoc) return null;
                const active = activeTab?.path === scriptPath;
                const engMeta = getScriptEngineMeta(tc.scriptEngine || inferScriptEngineForTest(tc));
                return (
                  <button
                    key={scriptPath}
                    type="button"
                    onClick={() => openFile(scriptPath)}
                    data-testid={`vscode-script-${tc.id}`}
                    className={`flex w-full items-center justify-between gap-1.5 px-2.5 py-1 text-left font-mono text-[11px] cursor-pointer ${
                      active
                        ? 'bg-accent text-accent-foreground font-semibold shadow-[inset_2px_0_0_var(--bg-primary)]'
                        : 'text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <FileCode2 className="h-3 w-3 shrink-0 text-primary" />
                      <span className="truncate">
                        {vdoc.label} · {tc.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-[9px] text-muted-foreground">
                      {engMeta.shortBadge}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-b border-border/70 py-1">
            <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pinned Blueprints
            </div>
            {CURATED_WORKSPACE_QUICK_FILES.map((qf) => {
              const active = activeTab?.path === qf.path;
              return (
                <button
                  key={qf.path}
                  type="button"
                  onClick={() => openFile(qf.path)}
                  className={`flex w-full items-center gap-1.5 px-2.5 py-1 text-left font-mono text-[11px] cursor-pointer ${
                    active
                      ? 'bg-accent text-accent-foreground font-semibold shadow-[inset_2px_0_0_var(--bg-primary)]'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  }`}
                >
                  <FileCode2 className="h-3 w-3 shrink-0 opacity-70" />
                  <span className="truncate">{qf.label}</span>
                </button>
              );
            })}
          </div>

          <div className="py-1">
            <div className="px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Repository Files
            </div>
            {renderTreeNodes(treeEntries)}
          </div>
        </div>
      )}

      {activityTab === 'search' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <form onSubmit={handleRunSearch} className="border-b border-border p-2 space-y-1.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1.5 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search repo (min 2 chars)…"
                className="h-6.5 w-full rounded border border-border bg-background pl-6.5 pr-2 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={searching}
              className="h-6.5 w-full rounded bg-primary text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {searching ? 'Searching…' : 'Search Workspace'}
            </button>
          </form>

          <div className="flex-1 overflow-y-auto divide-y divide-border/60">
            {searchHits.map((hit, idx) => (
              <button
                key={`${hit.path}-${hit.line}-${idx}`}
                type="button"
                onClick={() => openFile(hit.path)}
                className="w-full px-2.5 py-1.5 text-left hover:bg-muted/60 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="font-semibold text-primary truncate">{hit.path}</span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    L{hit.line}
                  </span>
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {hit.preview}
                </div>
              </button>
            ))}
            {searchHits.length === 0 && (
              <div className="px-2.5 py-5 text-center text-[11px] text-muted-foreground">
                Search TypeScript, Terraform, or config symbols across the workspace.
              </div>
            )}
          </div>
        </div>
      )}

      {activityTab === 'plugins' && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-3 text-xs">
          <div>
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              <span>Pipeline · {pluginReport.testId}</span>
              <span className="font-mono text-foreground">{pluginReport.overallPipelineVerdict}</span>
            </div>
            <div className="space-y-1">
              {pluginReport.results.map((ev) => (
                <div
                  key={ev.pluginId}
                  className="rounded border border-border bg-background p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-foreground truncate">
                      {ev.pluginName}
                    </span>
                    <span
                      className={`font-mono text-[10px] font-semibold uppercase shrink-0 ${
                        ev.verdict === 'FAIL'
                          ? 'text-rose-600 dark:text-rose-400'
                          : ev.verdict === 'WARN'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {ev.verdict}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
                    {ev.summary}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-2 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              AI Adaptation Kit
            </div>
            <button
              type="button"
              onClick={() => openFile('live://one-shot-adaptation.md')}
              className="flex w-full items-center justify-between rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] hover:bg-muted cursor-pointer"
            >
              <span>One-Shot Prompt</span>
              <span className="text-primary">Open</span>
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(
                  adaptationBundle.find((f) => f.filename === 'CLAUDE.md')?.content || ''
                );
                toast.success('Copied CLAUDE.md instructions');
              }}
              className="flex w-full items-center justify-between rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] hover:bg-muted cursor-pointer"
            >
              <span>Copy CLAUDE.md</span>
              <Copy className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      data-testid="vscode-workspace"
      className="flex flex-col h-[calc(100vh-3rem)] min-h-[540px] bg-background min-w-0"
    >
      <div className="flex flex-1 min-h-0 min-w-0 relative">
        {/* VS Code Activity Bar */}
        <div className="flex w-9 shrink-0 flex-col items-center justify-between border-r border-border bg-card py-1.5">
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen((v) => !v)}
              aria-label="Toggle workspace explorer drawer"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground md:hidden cursor-pointer"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                if (activityTab === 'explorer' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActivityTab('explorer');
                  setSidebarCollapsed(false);
                  setMobileSidebarOpen(true);
                }
              }}
              data-testid="vscode-act-explorer"
              aria-label="Workspace Explorer"
              title="Explorer (click to toggle)"
              className={`inline-flex h-7 w-7 items-center justify-center rounded cursor-pointer ${
                activityTab === 'explorer' && !sidebarCollapsed
                  ? 'text-primary bg-accent shadow-[inset_2px_0_0_var(--bg-primary)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <FileCode2 className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                if (activityTab === 'search' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActivityTab('search');
                  setSidebarCollapsed(false);
                  setMobileSidebarOpen(true);
                }
              }}
              data-testid="vscode-act-search"
              aria-label="Workspace Search"
              title="Search (click to toggle)"
              className={`inline-flex h-7 w-7 items-center justify-center rounded cursor-pointer ${
                activityTab === 'search' && !sidebarCollapsed
                  ? 'text-primary bg-accent shadow-[inset_2px_0_0_var(--bg-primary)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Search className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => {
                if (activityTab === 'plugins' && !sidebarCollapsed) {
                  setSidebarCollapsed(true);
                } else {
                  setActivityTab('plugins');
                  setSidebarCollapsed(false);
                  setMobileSidebarOpen(true);
                }
              }}
              data-testid="vscode-act-plugins"
              aria-label="Plugins and AI Skills"
              title="Plugins & AI Skills (click to toggle)"
              className={`inline-flex h-7 w-7 items-center justify-center rounded cursor-pointer ${
                activityTab === 'plugins' && !sidebarCollapsed
                  ? 'text-primary bg-accent shadow-[inset_2px_0_0_var(--bg-primary)]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Puzzle className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setTerminalOpen((v) => !v)}
            data-testid="vscode-toggle-terminal"
            aria-label="Toggle integrated terminal"
            title="Toggle Terminal"
            className={`inline-flex h-7 w-7 items-center justify-center rounded cursor-pointer ${
              terminalOpen
                ? 'text-primary bg-accent'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Desktop Sidebar */}
        {!sidebarCollapsed && <div className="hidden md:flex">{sidebarPanel}</div>}

        {/* Mobile Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileSidebarOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 flex h-full max-w-[85vw] shadow-xl">
              {sidebarPanel}
            </div>
          </div>
        )}

        {/* Main Editor + Terminal Stack */}
        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          {/* Open Editor Tabs + Breadcrumb + Save Action in a single 30px micro-bar */}
          <div className="flex items-center justify-between border-b border-border bg-card min-h-7.5 overflow-x-auto">
            <div className="flex items-center divide-x divide-border/70 min-w-0">
              {tabs.map((tab) => {
                const active = tab.path === activeTab?.path;
                const dirty = tab.content !== tab.savedContent;
                return (
                  <div
                    key={tab.path}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-background text-foreground font-semibold shadow-[inset_0_2px_0_var(--bg-primary)]'
                        : 'text-muted-foreground hover:bg-muted/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveTabPath(tab.path)}
                      className="cursor-pointer"
                    >
                      {tab.label}
                      {dirty ? ' •' : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCloseTab(tab.path)}
                      aria-label={`Close ${tab.label}`}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {activeTab && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 shrink-0">
                <span className="hidden xl:inline font-mono text-[10px] text-muted-foreground truncate max-w-[200px]">
                  {activeTab.path}
                </span>

                {isDirty ? (
                  <span
                    data-testid="vscode-dirty-badge"
                    className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-700 dark:text-amber-300"
                  >
                    Unsaved
                  </span>
                ) : lastSavedMap[activeTab.path] ? (
                  <span
                    data-testid="vscode-saved-badge"
                    className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    <Check className="h-2.5 w-2.5" />
                    <span>Saved {lastSavedMap[activeTab.path]}</span>
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() =>
                    setEditorMode((m) => (m === 'monaco' ? 'plain' : 'monaco'))
                  }
                  data-testid="vscode-editor-mode-toggle"
                  title="Switch between Monaco Code Editor and Direct Plain Text Editor"
                  className="inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                >
                  <Code2 className="h-2.5 w-2.5" />
                  <span className="hidden sm:inline">
                    {editorMode === 'monaco' ? 'Monaco' : 'Plain Text'}
                  </span>
                </button>

                {isDirty && (
                  <button
                    type="button"
                    onClick={() => handleRevertTab(activeTab)}
                    data-testid="vscode-revert-btn"
                    title="Revert unsaved edits"
                    className="inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    <span className="hidden sm:inline">Revert</span>
                  </button>
                )}

                {!activeTab.isVirtual && !activeTab.path.startsWith('live://') && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleReloadTabFromDisk(activeTab)}
                      data-testid="vscode-reload-btn"
                      title="Reload latest file content from disk"
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                    >
                      <RefreshCw className="h-2.5 w-2.5" />
                    </button>

                    {confirmDeletePath === activeTab.path ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteFile(activeTab.path)}
                          data-testid="vscode-confirm-delete-btn"
                          className="inline-flex h-6 items-center rounded border border-rose-500/50 bg-rose-600 px-1.5 text-[10px] font-semibold text-white hover:opacity-90 cursor-pointer"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePath(null)}
                          className="inline-flex h-6 items-center rounded border border-border bg-background px-1.5 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeletePath(activeTab.path)}
                        data-testid="vscode-delete-file-btn"
                        title={`Delete ${activeTab.path} from workspace`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-rose-600 hover:border-rose-500/40 cursor-pointer"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(activeTab.content);
                    toast.success(`Copied ${activeTab.label}`);
                  }}
                  className="inline-flex h-6 items-center gap-1 rounded border border-border bg-background px-1.5 text-[10px] font-medium hover:bg-muted cursor-pointer"
                >
                  <Copy className="h-2.5 w-2.5 text-muted-foreground" />
                  <span className="hidden md:inline">Copy</span>
                </button>

                {activeTab.path.startsWith(`live://script/${appId}/`) && (
                  <button
                    type="button"
                    disabled={scriptRunning}
                    onClick={handleRunActiveScript}
                    data-testid="vscode-run-script-btn"
                    className="inline-flex h-6 items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="h-2.5 w-2.5 fill-current" />
                    <span>Run Script</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={(!isDirty && !activeTab.isVirtual) || savingPath === activeTab.path}
                  onClick={() => handleSaveTab(activeTab)}
                  data-testid="vscode-save-btn"
                  title="Save file to underlying disk (Ctrl+S / Cmd+S)"
                  className="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-45 cursor-pointer"
                >
                  <Save className="h-2.5 w-2.5" />
                  <span>
                    {savingPath === activeTab.path
                      ? 'Saving…'
                      : activeTab.path.startsWith('live://')
                      ? 'Apply Live'
                      : 'Save (Ctrl+S)'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Monaco / Plain Text File Editor */}
          <div className="flex-1 min-h-[220px] bg-background relative">
            {activeTab ? (
              editorMode === 'plain' ? (
                <textarea
                  data-testid="vscode-plain-editor"
                  aria-label={`Edit ${activeTab.path}`}
                  value={activeTab.content}
                  onChange={(e) => {
                    const next = e.target.value;
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === activeTab.path ? { ...t, content: next } : t
                      )
                    );
                  }}
                  spellCheck={false}
                  className="h-full w-full resize-none bg-background p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none"
                />
              ) : (
                <Editor
                  height="100%"
                  path={activeTab.path}
                  language={activeTab.language}
                  theme={theme === 'dark' ? 'vs-dark' : 'vs'}
                  value={activeTab.content}
                  onMount={(editor) => {
                    editor.addCommand(
                      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
                      () => {
                        handleSaveRef.current();
                      }
                    );
                  }}
                  onChange={(val) => {
                    const next = val ?? '';
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === activeTab.path ? { ...t, content: next } : t
                      )
                    );
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12.5,
                    fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
                    lineNumbersMinChars: 3,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    padding: { top: 8 },
                    tabSize: 2,
                    readOnly: false,
                  }}
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Select a file from the Explorer to inspect or edit.
              </div>
            )}
          </div>

          {/* Integrated Real Kernel Full-TTY Terminal (@xterm/xterm + /dev/pts/N) */}
          {terminalOpen ? (
            <ComputePtyTerminal
              ref={ptyTerminalRef}
              theme={theme}
              computeInfo={computeInfo}
              maximized={terminalMaximized}
              onToggleMaximize={() => setTerminalMaximized((v) => !v)}
              onHide={() => setTerminalOpen(false)}
              onWorkspaceMutated={loadTree}
            />
          ) : (
            <div className="flex h-6 items-center justify-between border-t border-border bg-card px-2.5 text-[10px] font-mono text-muted-foreground shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTerminalOpen(true)}
                  data-testid="vscode-terminal-open-btn"
                  className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary cursor-pointer"
                >
                  <Terminal className="h-3 w-3 text-primary" />
                  <span>
                    Full TTY Terminal (
                    {computeInfo
                      ? `${computeInfo.user}@${computeInfo.hostname}`
                      : '/bin/bash'}
                    )
                  </span>
                </button>
              </div>
              {activeTab && (
                <div className="flex items-center gap-2">
                  <span>{activeTab.language.toUpperCase()}</span>
                  <span>·</span>
                  <span>UTF-8</span>
                  <span>·</span>
                  <span>Ctrl+S to save</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
