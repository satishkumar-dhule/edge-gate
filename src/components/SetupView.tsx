import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppConfig, EnvironmentConfig } from '../engine/types';
import { TestCaseDefinition, resolvePropertyHostname } from '../config/template.config';
import {
  DEFAULT_TEST_FOLDERS,
  cloneTestInSuite,
  generateNextTestId,
  getCatchpointTypeMeta,
  normalizeTestCaseWithCatchpointDefaults,
  reorderTestInSuite,
  upsertTestInSuite,
} from '../engine/catchpointCatalog';
import { CATCHPOINT_TEST_PRESETS } from '../engine/complexTestEngine';
import { getScriptEngineMeta } from '../engine/scriptTemplates';
import { CatchpointTestModal } from './CatchpointTestModal';

export interface SetupViewProps {
  apps: AppConfig[];
  activeAppId: string;
  suitesByAppId: Record<string, TestCaseDefinition[]>;
  initialTab?: 'suite' | 'envs';
  controlledTab?: 'suite' | 'envs';
  hideInnerTabs?: boolean;
  onSelectApp: (appId: string) => void;
  onCreateProperty: (newProp: AppConfig) => void;
  onSaveProperty: (updatedProp: AppConfig) => void;
  onDeleteProperty: (appId: string) => void;
  onSaveSuite: (appId: string, suite: TestCaseDefinition[]) => void;
  onOpenSynthetics?: () => void;
}

export const SetupView: React.FC<SetupViewProps> = ({
  apps,
  activeAppId,
  suitesByAppId,
  initialTab,
  controlledTab,
  hideInnerTabs = false,
  onSelectApp,
  onCreateProperty,
  onSaveProperty,
  onDeleteProperty,
  onSaveSuite,
  onOpenSynthetics,
}) => {
  const [internalSetupTab, setInternalSetupTab] = useState<'suite' | 'envs'>(initialTab || 'suite');
  const setupTab = controlledTab ?? internalSetupTab;
  const setSetupTab = (next: 'suite' | 'envs') => setInternalSetupTab(next);
  const [syncingAwsCanaries, setSyncingAwsCanaries] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const templatesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialTab) setInternalSetupTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!templatesOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (templatesRef.current && !templatesRef.current.contains(e.target as Node)) {
        setTemplatesOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [templatesOpen]);

  // New Property State
  const [newPropId, setNewPropId] = useState('');
  const [newPropName, setNewPropName] = useState('');
  const [newPropHost, setNewPropHost] = useState('');

  // Quick Add Test Check State
  const [newCheckPath, setNewCheckPath] = useState('');
  const [newCheckName, setNewCheckName] = useState('');
  const [newCheckStatus, setNewCheckStatus] = useState('200');
  const [newCheckCategory, setNewCheckCategory] = useState('Edge');
  const [newCheckMethod, setNewCheckMethod] = useState('GET');

  // Complex Catchpoint Test Modal State
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [checkSearchQuery, setCheckSearchQuery] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [modalDraft, setModalDraft] = useState<TestCaseDefinition | null>(null);
  const [modalOriginalId, setModalOriginalId] = useState<string | undefined>(undefined);

  // Add Environment State
  const [newEnvId, setNewEnvId] = useState('');
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvTargetHost, setNewEnvTargetHost] = useState('');
  const [newEnvStaging, setNewEnvStaging] = useState(true);
  const [newEnvProd, setNewEnvProd] = useState(true);

  // Edit Environment State
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
  const [editEnvDraft, setEditEnvDraft] = useState<{
    name: string;
    staging: boolean;
    prod: boolean;
    hostEntries: Array<{ canonical: string; mapped: string }>;
  }>({ name: '', staging: true, prod: true, hostEntries: [] });

  const activeProp = apps.find((a) => a.id === activeAppId) || apps[0];
  const activeSuite = suitesByAppId[activeProp?.id || ''] || [];
  const qLower = checkSearchQuery.trim().toLowerCase();
  const filteredSuite = activeSuite.filter((tc) => {
    if (folderFilter !== 'all' && (tc.folderId || 'folder-core') !== folderFilter) {
      return false;
    }
    if (qLower) {
      const hay = `${tc.id} ${tc.name} ${tc.path} ${tc.category || ''} ${tc.testType || ''}`.toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });
  const defaultCanonical = activeProp
    ? resolvePropertyHostname(activeProp.id, 'prod')
    : 'www.salesforce.com';

  const handleAddProperty = (e: React.FormEvent) => {
    e.preventDefault();
    const id = newPropId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!id || !newPropName.trim()) return;
    const host = newPropHost.trim() || resolvePropertyHostname(id, 'prod');
    const created: AppConfig = {
      id,
      name: newPropName.trim(),
      suitePath: `config/suites/${id}.csv`,
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { [host]: host },
          networks: ['prod', 'staging'],
        },
      ],
    };
    onCreateProperty(created);
    setNewPropId('');
    setNewPropName('');
    setNewPropHost('');
  };

  // --- Test Check CRUD ---
  const handleAddCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProp || !newCheckPath.trim()) return;
    const nextId = generateNextTestId(activeSuite);
    const rawInput = newCheckPath.trim();
    let cleanPath = rawInput;
    let parsedHost: string | undefined;
    if (/^https?:\/\//i.test(rawInput)) {
      try {
        const u = new URL(rawInput);
        cleanPath = `${u.pathname || '/'}${u.search || ''}`;
        if (u.hostname && u.hostname.toLowerCase() !== defaultCanonical.toLowerCase()) {
          parsedHost = u.hostname;
        }
      } catch {
        cleanPath = rawInput;
      }
    } else if (!rawInput.startsWith('/')) {
      cleanPath = `/${rawInput}`;
    }
    const draft = normalizeTestCaseWithCatchpointDefaults(
      {
        id: nextId,
        name: newCheckName.trim() || `Synthetic Monitor (${cleanPath})`,
        path: cleanPath,
        ...(parsedHost ? { targetHost: parsedHost } : {}),
        expectedStatus: newCheckStatus.trim() || '200',
        category: newCheckCategory.trim() || 'Edge',
        httpMethod: (newCheckMethod.trim().toUpperCase() || 'GET') as TestCaseDefinition['httpMethod'],
        enabled: true,
      },
      activeSuite.length
    );
    onSaveSuite(activeProp.id, [...activeSuite, draft]);
    setNewCheckPath('');
    setNewCheckName('');
  };

  const openCreateComplexModal = (presetTemplate?: Partial<TestCaseDefinition>) => {
    const nextId = generateNextTestId(activeSuite);
    const base = normalizeTestCaseWithCatchpointDefaults(
      {
        id: nextId,
        name: presetTemplate?.name || 'Complex Edge Synthetic Check',
        path: presetTemplate?.path || '/',
        expectedStatus: presetTemplate?.expectedStatus || '200',
        category: presetTemplate?.category || 'Edge',
        testType: presetTemplate?.testType || 'transaction-playwright',
        ...presetTemplate,
        enabled: true,
      },
      activeSuite.length
    );
    setModalMode('create');
    setModalDraft(base);
    setModalOriginalId(undefined);
    setModalOpen(true);
  };

  const startEditCheck = (tc: TestCaseDefinition) => {
    setModalMode('edit');
    setModalDraft(normalizeTestCaseWithCatchpointDefaults(tc));
    setModalOriginalId(tc.id);
    setModalOpen(true);
  };

  const handleSaveComplexModal = (draft: TestCaseDefinition, originalId?: string) => {
    if (!activeProp) return;
    const nextSuite = upsertTestInSuite(activeSuite, draft, originalId);
    onSaveSuite(activeProp.id, nextSuite);
    setModalOpen(false);
  };

  const handleCloneCheck = (testId: string) => {
    if (!activeProp) return;
    const { suite: nextSuite } = cloneTestInSuite(activeSuite, testId);
    onSaveSuite(activeProp.id, nextSuite);
  };

  const handleReorderCheck = (testId: string, dir: 'up' | 'down') => {
    if (!activeProp) return;
    const nextSuite = reorderTestInSuite(activeSuite, testId, dir);
    onSaveSuite(activeProp.id, nextSuite);
  };

  const handleToggleCheck = (testId: string) => {
    if (!activeProp) return;
    onSaveSuite(
      activeProp.id,
      activeSuite.map((tc) =>
        tc.id === testId ? { ...tc, enabled: tc.enabled === false } : tc
      )
    );
  };

  const handleDeleteCheck = (testId: string) => {
    if (!activeProp || activeSuite.length <= 1) return;
    onSaveSuite(
      activeProp.id,
      activeSuite.filter((tc) => tc.id !== testId)
    );
  };

  // --- Environment CRUD ---
  const handleAddEnv = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProp) return;
    const cleanId = newEnvId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!cleanId) return;
    if (activeProp.envs.some((env) => env.id.toLowerCase() === cleanId)) return;

    const networks: Array<'prod' | 'staging'> = [];
    if (newEnvProd) networks.push('prod');
    if (newEnvStaging) networks.push('staging');
    if (networks.length === 0) networks.push('staging');

    const mappedHost =
      newEnvTargetHost.trim() || resolvePropertyHostname(activeProp.id, cleanId);

    const newEnv: EnvironmentConfig = {
      id: cleanId,
      name: newEnvName.trim() || cleanId.toUpperCase(),
      hostMap: { [defaultCanonical]: mappedHost },
      networks,
    };

    onSaveProperty({
      ...activeProp,
      envs: [...activeProp.envs, newEnv],
    });
    setNewEnvId('');
    setNewEnvName('');
    setNewEnvTargetHost('');
    setNewEnvStaging(true);
    setNewEnvProd(true);
  };

  const startEditEnv = (env: EnvironmentConfig) => {
    setEditingEnvId(env.id);
    const nets = env.networks || ['prod', 'staging'];
    const entries = Object.entries(env.hostMap || {}).map(([canonical, mapped]) => ({
      canonical,
      mapped: String(mapped),
    }));
    setEditEnvDraft({
      name: env.name,
      staging: nets.includes('staging'),
      prod: nets.includes('prod'),
      hostEntries:
        entries.length > 0
          ? entries
          : [{ canonical: defaultCanonical, mapped: defaultCanonical }],
    });
  };

  const handleSaveEditEnv = (envId: string) => {
    if (!activeProp) return;
    const networks: Array<'prod' | 'staging'> = [];
    if (editEnvDraft.prod) networks.push('prod');
    if (editEnvDraft.staging) networks.push('staging');
    if (networks.length === 0) networks.push('staging');

    const hostMap: Record<string, string> = {};
    for (const pair of editEnvDraft.hostEntries) {
      const k = pair.canonical.trim();
      const v = pair.mapped.trim();
      if (k && v) hostMap[k] = v;
    }

    const nextEnvs = activeProp.envs.map((env) =>
      env.id === envId
        ? {
            ...env,
            name: editEnvDraft.name.trim() || env.id.toUpperCase(),
            networks,
            hostMap: Object.keys(hostMap).length > 0 ? hostMap : env.hostMap,
          }
        : env
    );

    onSaveProperty({ ...activeProp, envs: nextEnvs });
    setEditingEnvId(null);
  };

  const handleDeleteEnv = (envId: string) => {
    if (!activeProp || activeProp.envs.length <= 1) return;
    if (editingEnvId === envId) setEditingEnvId(null);
    onSaveProperty({
      ...activeProp,
      envs: activeProp.envs.filter((env) => env.id !== envId),
    });
  };

  const [showAddPropForm, setShowAddPropForm] = useState(false);
  const [showQuickAddRow, setShowQuickAddRow] = useState(false);

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col lg:overflow-hidden">
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[205px_1fr] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        <aside className="flex flex-col min-h-0 bg-card border-b lg:border-b-0 lg:border-r border-border lg:overflow-hidden">
          <div className="shrink-0 flex items-center justify-between border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
            <span>Sites ({apps.length})</span>
            <button
              type="button"
              onClick={() => setShowAddPropForm((v) => !v)}
              data-testid="btn-toggle-add-property"
              className="inline-flex h-6.5 items-center gap-1 rounded border border-border bg-background px-2 font-sans text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
            >
              <Plus className="h-3 w-3 text-primary" />
              <span>Site</span>
            </button>
          </div>

          {showAddPropForm && (
            <form
              onSubmit={(e) => {
                handleAddProperty(e);
                setShowAddPropForm(false);
              }}
              className="shrink-0 border-b border-border bg-muted/25 p-2 space-y-1.5 text-xs"
            >
              <input
                type="text"
                value={newPropId}
                onChange={(e) => setNewPropId(e.target.value)}
                placeholder="ID (e.g. commerce)"
                aria-label="New property ID"
                className="h-7.5 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
              <input
                type="text"
                value={newPropName}
                onChange={(e) => setNewPropName(e.target.value)}
                placeholder="Display Name"
                aria-label="New property display name"
                className="h-7.5 w-full rounded border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
              />
              <input
                type="text"
                value={newPropHost}
                onChange={(e) => setNewPropHost(e.target.value)}
                placeholder="Canonical Host"
                aria-label="New property canonical host"
                className="h-7.5 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-7.5 w-full items-center justify-center gap-1 rounded bg-primary text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Property</span>
              </button>
            </form>
          )}

          <div className="flex-1 min-h-0 max-h-60 lg:max-h-none overflow-y-auto divide-y divide-border/60">
            {apps.map((app) => {
              const active = app.id === activeProp?.id;
              return (
                <div
                  key={app.id}
                  className={`flex items-center justify-between px-2.5 py-1.5 text-xs transition-colors ${
                    active
                      ? 'bg-accent/70 border-l-2 border-l-primary'
                      : 'hover:bg-muted/45 border-l-2 border-l-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectApp(app.id);
                      setEditingEnvId(null);
                    }}
                    className="flex-1 text-left cursor-pointer min-w-0"
                  >
                    <div className="font-mono text-xs font-semibold text-foreground leading-tight">
                      {app.id}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                      {app.name}
                    </div>
                  </button>
                  {apps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteProperty(app.id)}
                      aria-label={`Delete property ${app.id}`}
                      className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-rose-600 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {activeProp && (
          <div className="flex flex-col min-w-0 min-h-0 bg-card lg:overflow-hidden">
            {/* Compact Property Header Bar */}
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="font-mono text-xs font-bold text-primary">
                  {activeProp.id}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-sm font-semibold text-foreground">
                  {activeProp.name}
                </span>
                {!activeProp.name.toLowerCase().includes(defaultCanonical.toLowerCase()) && (
                  <span className="hidden sm:inline font-mono text-[11px] text-muted-foreground">
                    · {defaultCanonical}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 text-xs">
                {!hideInnerTabs && (
                  <div className="flex items-center gap-4 mr-2">
                    <button
                      type="button"
                      onClick={() => setSetupTab('suite')}
                      data-testid="setup-tab-suite"
                      className={`relative py-1 font-medium cursor-pointer transition-colors ${
                        setupTab === 'suite'
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Checks ({activeSuite.length})
                      {setupTab === 'suite' && (
                        <span className="absolute inset-x-0 -bottom-[9px] h-0.5 bg-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSetupTab('envs')}
                      data-testid="setup-tab-envs"
                      className={`relative py-1 font-medium cursor-pointer transition-colors ${
                        setupTab === 'envs'
                          ? 'text-foreground font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Environments ({activeProp.envs.length})
                      {setupTab === 'envs' && (
                        <span className="absolute inset-x-0 -bottom-[9px] h-0.5 bg-primary" />
                      )}
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  disabled={syncingAwsCanaries}
                  data-testid="setup-sync-aws-synthetics"
                  onClick={async () => {
                    setSyncingAwsCanaries(true);
                    try {
                      const res = await fetch('/api/v1/synthetics/canaries/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ appId: activeProp.id }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      const data = await res.json();
                      toast.success(
                        `Synced ${data.totalSyncedCanaries ?? 2} AWS Synthetics canaries for ${activeProp.id}`
                      );
                    } catch (err) {
                      toast.error(
                        `AWS sync failed: ${err instanceof Error ? err.message : 'Error'}`
                      );
                    } finally {
                      setSyncingAwsCanaries(false);
                    }
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer"
                >
                  {syncingAwsCanaries ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  ) : (
                    <UploadCloud className="h-3 w-3 text-primary" />
                  )}
                  <span>Sync AWS</span>
                </button>

                {onOpenSynthetics && (
                  <button
                    type="button"
                    onClick={onOpenSynthetics}
                    className="text-xs font-medium text-primary hover:underline cursor-pointer"
                  >
                    All Sites →
                  </button>
                )}
              </div>
            </div>

            {setupTab === 'suite' && (
              <div className="flex flex-1 flex-col min-h-0 lg:overflow-hidden">
                {/* Simplified Single-Line Checks Action Bar */}
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/15 px-4 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-48 sm:w-56">
                      <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                      <input
                        type="text"
                        value={checkSearchQuery}
                        onChange={(e) => setCheckSearchQuery(e.target.value)}
                        placeholder="Search checks…"
                        aria-label="Search suite checks"
                        className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                      {checkSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setCheckSearchQuery('')}
                          aria-label="Clear suite search"
                          className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <select
                      value={folderFilter}
                      onChange={(e) => setFolderFilter(e.target.value)}
                      aria-label="Filter checks by folder"
                      className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none cursor-pointer"
                    >
                      <option value="all">All Folders ({activeSuite.length})</option>
                      {DEFAULT_TEST_FOLDERS.map((folder) => {
                        const cnt = activeSuite.filter(
                          (t) => (t.folderId || 'folder-core') === folder.id
                        ).length;
                        return (
                          <option key={folder.id} value={folder.id}>
                            {folder.name.split(' ')[0].replace(/,+$/, '')} ({cnt})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2" ref={templatesRef}>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTemplatesOpen((v) => !v)}
                        data-testid="btn-check-templates"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer whitespace-nowrap"
                      >
                        <span>Templates</span>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>

                      {templatesOpen && (
                        <div className="absolute right-0 top-9.5 z-40 w-56 rounded-md border border-border bg-popover p-1.5 shadow-lg text-xs">
                          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Quick Presets
                          </div>
                          {CATCHPOINT_TEST_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setTemplatesOpen(false);
                                openCreateComplexModal(preset.template);
                              }}
                              data-testid={`setup-${preset.id}`}
                              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-foreground hover:bg-muted cursor-pointer"
                            >
                              <Plus className="h-3 w-3 text-primary shrink-0" />
                              <span>{preset.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowQuickAddRow((v) => !v)}
                      data-testid="btn-toggle-quick-add"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5 text-primary" />
                      <span>Quick URL</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openCreateComplexModal()}
                      data-testid="btn-new-complex-test"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer whitespace-nowrap"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>New Check</span>
                    </button>
                  </div>
                </div>

                {showQuickAddRow && (
                  <form
                    onSubmit={(e) => {
                      handleAddCheck(e);
                      setShowQuickAddRow(false);
                    }}
                    className="grid grid-cols-1 gap-2 border-b border-border bg-muted/25 px-4 py-2.5 sm:grid-cols-[1.2fr_1.3fr_76px_76px_100px_auto]"
                  >
                    <input
                      type="text"
                      value={newCheckPath}
                      onChange={(e) => setNewCheckPath(e.target.value)}
                      placeholder="Quick add path (e.g. /pricing)"
                      aria-label="New check path"
                      data-testid="add-check-path"
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newCheckName}
                      onChange={(e) => setNewCheckName(e.target.value)}
                      placeholder="Check Name"
                      aria-label="New check name"
                      data-testid="add-check-name"
                      className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newCheckStatus}
                      onChange={(e) => setNewCheckStatus(e.target.value)}
                      placeholder="200"
                      aria-label="New check expected status"
                      data-testid="add-check-status"
                      className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <select
                      value={newCheckMethod}
                      onChange={(e) => setNewCheckMethod(e.target.value)}
                      aria-label="New check HTTP method"
                      className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    >
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                      <option value="POST">POST</option>
                    </select>
                    <input
                      type="text"
                      value={newCheckCategory}
                      onChange={(e) => setNewCheckCategory(e.target.value)}
                      placeholder="Category"
                      aria-label="New check category"
                      className="h-8 rounded-md border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="submit"
                      data-testid="btn-add-check"
                      className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5 text-primary" />
                      <span>Add</span>
                    </button>
                  </form>
                )}

                <div className="flex-1 min-h-0 overflow-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-xs">
                      <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-1.5">ID</th>
                        <th className="px-3 py-1.5">Monitor & Check Name</th>
                        <th className="px-3 py-1.5">Endpoint / Spec</th>
                        <th className="px-3 py-1.5">Expected</th>
                        <th className="px-3 py-1.5">State</th>
                        <th className="px-3 py-1.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {filteredSuite.map((tc, rowIdx) => {
                        const typeMeta = getCatchpointTypeMeta(tc.testType);
                        const stepCount = tc.transactionSteps?.length || 0;
                        const headerCount = Object.keys(tc.requestHeaders || {}).length;
                        const assertionDetails: string[] = [];
                        if (tc.assertions?.expectedBodyMatch) {
                          assertionDetails.push(`body~/${tc.assertions.expectedBodyMatch}/`);
                        }
                        if (tc.assertions?.maxLatencyMs) {
                          assertionDetails.push(`max ${tc.assertions.maxLatencyMs}ms`);
                        }
                        if (tc.assertions?.minTlsVersion) {
                          assertionDetails.push(`>=${tc.assertions.minTlsVersion}`);
                        }
                        if (tc.sslMinExpiryDays) {
                          assertionDetails.push(`cert>=${tc.sslMinExpiryDays}d`);
                        }
                        if (tc.dnsRecordType) {
                          assertionDetails.push(`${tc.dnsRecordType} @${tc.dnsServer || '8.8.8.8'}`);
                        }
                        if (tc.bgpOriginAsn) {
                          assertionDetails.push(tc.bgpOriginAsn);
                        }

                        return (
                          <tr
                            key={tc.id}
                            data-testid={`setup-check-row-${tc.id}`}
                            className="group hover:bg-muted/30"
                          >
                            <td className="px-3 py-2 font-mono font-semibold text-foreground align-top">
                              <div>{tc.id}</div>
                              {tc.critical && (
                                <div className="text-[10px] font-semibold uppercase text-rose-600 dark:text-rose-400">
                                  critical
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-medium text-foreground align-top">
                              <div>{tc.name}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                <span className="text-primary font-medium">
                                  {typeMeta.shortLabel}
                                </span>
                                <span>·</span>
                                <span>{tc.category || typeMeta.familyLabel}</span>
                                {stepCount > 0 && (
                                  <>
                                    <span>·</span>
                                    <span>{stepCount} steps</span>
                                  </>
                                )}
                                {headerCount > 0 && (
                                  <>
                                    <span>·</span>
                                    <span>{headerCount} hdrs</span>
                                  </>
                                )}
                                {tc.requestBody?.trim() && (
                                  <>
                                    <span>·</span>
                                    <span>body</span>
                                  </>
                                )}
                                {tc.customScript?.trim() && (
                                  <>
                                    <span>·</span>
                                    <span className="text-primary font-semibold">
                                      script:{getScriptEngineMeta(tc.scriptEngine || 'playwright').shortBadge} (
                                      {tc.customScript.trim().split('\n').length}L)
                                    </span>
                                  </>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-muted-foreground align-top">
                              <div>
                                <span className="font-semibold text-foreground/80 mr-1.5">
                                  {tc.httpMethod || typeMeta.defaultMethod || 'GET'}
                                </span>
                                <span className="break-all">
                                  {tc.targetHost ? `${tc.targetHost}${tc.path}` : tc.path}
                                </span>
                                {tc.port && tc.port !== 443 && (
                                  <span className="text-foreground/70">:{tc.port}</span>
                                )}
                              </div>
                              {assertionDetails.length > 0 && (
                                <div className="mt-0.5 text-[10px] text-muted-foreground/90">
                                  {assertionDetails.join(' · ')}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono tabular-nums align-top">
                              <div>{tc.expectedStatus}</div>
                              <div className="text-[10px] text-muted-foreground">
                                {tc.scheduleIntervalMin ?? 5}m · SLA {tc.slaWarningMs ?? 800}ms
                              </div>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <button
                                type="button"
                                onClick={() => handleToggleCheck(tc.id)}
                                className={`font-mono text-[11px] font-semibold cursor-pointer ${
                                  tc.enabled !== false
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-muted-foreground line-through'
                                }`}
                              >
                                {tc.enabled !== false ? 'Active' : 'Disabled'}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap align-top">
                              <div className="inline-flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => startEditCheck(tc)}
                                  data-testid={`edit-check-btn-${tc.id}`}
                                  aria-label={`Configure check ${tc.id}`}
                                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer mr-1"
                                >
                                  <Pencil className="h-3 w-3 text-muted-foreground" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCloneCheck(tc.id)}
                                  data-testid={`clone-check-btn-${tc.id}`}
                                  aria-label={`Clone check ${tc.id}`}
                                  title="Duplicate check"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/70 opacity-70 group-hover:opacity-100 hover:text-foreground hover:bg-muted cursor-pointer transition-opacity"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={rowIdx === 0 || folderFilter !== 'all'}
                                  onClick={() => handleReorderCheck(tc.id, 'up')}
                                  aria-label={`Move ${tc.id} up`}
                                  title="Move up"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/70 opacity-70 group-hover:opacity-100 hover:text-foreground hover:bg-muted disabled:opacity-20 cursor-pointer transition-opacity"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    rowIdx === filteredSuite.length - 1 ||
                                    folderFilter !== 'all'
                                  }
                                  onClick={() => handleReorderCheck(tc.id, 'down')}
                                  aria-label={`Move ${tc.id} down`}
                                  title="Move down"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/70 opacity-70 group-hover:opacity-100 hover:text-foreground hover:bg-muted disabled:opacity-20 cursor-pointer transition-opacity"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={activeSuite.length <= 1}
                                  onClick={() => handleDeleteCheck(tc.id)}
                                  data-testid={`delete-check-btn-${tc.id}`}
                                  title="Delete check"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/70 opacity-70 group-hover:opacity-100 hover:text-rose-600 hover:bg-muted disabled:opacity-20 cursor-pointer transition-opacity"
                                  aria-label={`Delete check ${tc.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredSuite.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center">
                            <div className="text-xs font-medium text-foreground">
                              No test checks match the active filters.
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setFolderFilter('all');
                                setCheckSearchQuery('');
                              }}
                              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>Reset filters</span>
                            </button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {setupTab === 'envs' && (
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
                <form
                  onSubmit={handleAddEnv}
                  className="bg-muted/25 p-3.5 space-y-2.5 text-xs"
                >
                  <div className="font-semibold text-foreground">
                    Add Environment to {activeProp.id}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[125px_155px_1fr_auto_auto]">
                    <input
                      type="text"
                      value={newEnvId}
                      onChange={(e) => setNewEnvId(e.target.value)}
                      placeholder="ID (e.g. qa)"
                      aria-label="New environment ID"
                      data-testid="add-env-id"
                      className="h-8 rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newEnvName}
                      onChange={(e) => setNewEnvName(e.target.value)}
                      placeholder="Name (QA Stage)"
                      aria-label="New environment display name"
                      data-testid="add-env-name"
                      className="h-8 rounded border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newEnvTargetHost}
                      onChange={(e) => setNewEnvTargetHost(e.target.value)}
                      placeholder={`Mapped host (default: ${resolvePropertyHostname(activeProp.id, newEnvId || 'qa')})`}
                      aria-label="New environment target host"
                      data-testid="add-env-host"
                      className="h-8 rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <div className="flex items-center gap-3 px-1">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newEnvStaging}
                          onChange={(e) => setNewEnvStaging(e.target.checked)}
                          className="accent-primary"
                        />
                        <span className="font-mono text-[11px]">Staging</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newEnvProd}
                          onChange={(e) => setNewEnvProd(e.target.checked)}
                          className="accent-primary"
                        />
                        <span className="font-mono text-[11px]">Prod</span>
                      </label>
                    </div>
                    <button
                      type="submit"
                      data-testid="btn-add-env"
                      className="inline-flex h-8 items-center justify-center gap-1 rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Environment</span>
                    </button>
                  </div>
                </form>

                <div className="p-4 space-y-3 text-xs">
                  {activeProp.envs.map((env) => {
                    const isEditing = editingEnvId === env.id;

                    if (isEditing) {
                      return (
                        <div
                          key={env.id}
                          className="rounded border border-primary/50 bg-accent/30 p-3.5 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-primary">
                                {env.id}
                              </span>
                              <input
                                type="text"
                                value={editEnvDraft.name}
                                onChange={(e) =>
                                  setEditEnvDraft((d) => ({ ...d, name: e.target.value }))
                                }
                                aria-label={`Edit display name for env ${env.id}`}
                                data-testid={`edit-env-name-${env.id}`}
                                className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground"
                              />
                            </div>

                            <div className="flex items-center gap-3">
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editEnvDraft.staging}
                                  onChange={(e) =>
                                    setEditEnvDraft((d) => ({
                                      ...d,
                                      staging: e.target.checked,
                                    }))
                                  }
                                  className="accent-primary"
                                />
                                <span className="font-mono text-[11px]">staging</span>
                              </label>
                              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editEnvDraft.prod}
                                  onChange={(e) =>
                                    setEditEnvDraft((d) => ({
                                      ...d,
                                      prod: e.target.checked,
                                    }))
                                  }
                                  className="accent-primary"
                                />
                                <span className="font-mono text-[11px]">prod</span>
                              </label>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Canonical → Environment Host Mappings
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditEnvDraft((d) => ({
                                    ...d,
                                    hostEntries: [
                                      ...d.hostEntries,
                                      { canonical: '', mapped: '' },
                                    ],
                                  }))
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                              >
                                <Plus className="h-3 w-3" /> Add Mapping
                              </button>
                            </div>

                            {editEnvDraft.hostEntries.map((pair, idx) => (
                              <div
                                key={idx}
                                className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] items-center"
                              >
                                <input
                                  type="text"
                                  value={pair.canonical}
                                  onChange={(e) =>
                                    setEditEnvDraft((d) => ({
                                      ...d,
                                      hostEntries: d.hostEntries.map((item, i) =>
                                        i === idx
                                          ? { ...item, canonical: e.target.value }
                                          : item
                                      ),
                                    }))
                                  }
                                  placeholder="Canonical host"
                                  className="h-7.5 rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                                />
                                <input
                                  type="text"
                                  value={pair.mapped}
                                  onChange={(e) =>
                                    setEditEnvDraft((d) => ({
                                      ...d,
                                      hostEntries: d.hostEntries.map((item, i) =>
                                        i === idx ? { ...item, mapped: e.target.value } : item
                                      ),
                                    }))
                                  }
                                  placeholder="Environment host"
                                  data-testid={`edit-env-mapped-${env.id}-${idx}`}
                                  className="h-7.5 rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                                />
                                {editEnvDraft.hostEntries.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditEnvDraft((d) => ({
                                        ...d,
                                        hostEntries: d.hostEntries.filter(
                                          (_, i) => i !== idx
                                        ),
                                      }))
                                    }
                                    aria-label="Remove host mapping"
                                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:text-rose-600 cursor-pointer"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>

                          <div className="flex items-center justify-end gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingEnvId(null)}
                              className="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveEditEnv(env.id)}
                              data-testid={`save-env-${env.id}`}
                              className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground cursor-pointer"
                            >
                              <Check className="h-3 w-3" /> Save Environment
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={env.id}
                        data-testid={`env-card-${env.id}`}
                        className="rounded border border-border bg-background p-3.5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono font-semibold text-foreground">
                              {env.name}
                            </span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              ({env.id}) ·{' '}
                              {(env.networks || ['prod', 'staging'])
                                .map((n) => (n === 'staging' ? 'Staging' : n === 'prod' ? 'Prod' : n))
                                .join(' / ')}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditEnv(env)}
                              data-testid={`edit-env-btn-${env.id}`}
                              className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                            >
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              disabled={activeProp.envs.length <= 1}
                              onClick={() => handleDeleteEnv(env.id)}
                              data-testid={`delete-env-btn-${env.id}`}
                              aria-label={`Delete environment ${env.id}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-rose-600 hover:bg-muted disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                          {Object.entries(env.hostMap).map(([canonical, mapped]) => (
                            <div
                              key={canonical}
                              className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-1"
                            >
                              <span>{canonical}</span>
                              <span className="text-foreground">→ {mapped}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {modalDraft && (
        <CatchpointTestModal
          open={modalOpen}
          mode={modalMode}
          initialDraft={modalDraft}
          originalId={modalOriginalId}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveComplexModal}
        />
      )}
    </div>
  );
};
