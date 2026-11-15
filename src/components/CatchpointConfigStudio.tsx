import React, { useMemo, useState } from 'react';
import {
  AppConfig,
  CatchpointMonitorFamily,
  CatchpointTestType,
  EnvironmentConfig,
  EnvironmentTier,
  TestFolder,
  TransactionStep,
} from '../engine/types';
import {
  DEFAULT_TEMPLATE_CONFIG,
  GLOBAL_EXECUTION_POPS,
  TestCaseDefinition,
  resolvePropertyHostname,
} from '../config/template.config';
import {
  CATCHPOINT_FAMILY_META,
  CATCHPOINT_TEST_TYPES,
  cloneTestInSuite,
  deleteEnvironmentFromApp,
  deleteFolderAndReassign,
  deleteTestsFromSuite,
  generateNextTestId,
  getCatchpointTypeMeta,
  moveTestsToFolder,
  normalizeSuiteWithCatchpointDefaults,
  reorderEnvironmentInApp,
  reorderTestInSuite,
  toggleTestsEnabled,
  upsertEnvironmentInApp,
  upsertFolder,
  upsertTestInSuite,
  validateEnvironmentDraft,
  validateTestDraft,
} from '../engine/catchpointCatalog';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Edit3,
  Folder,
  FolderPlus,
  Globe,
  Layers,
  Play,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';

// ============================================================================
// 1. CATCHPOINT ENVIRONMENT & PROPERTY STUDIO
// ============================================================================
export interface CatchpointEnvironmentStudioProps {
  apps: AppConfig[];
  activeAppId: string;
  onSelectProperty: (appId: string) => void;
  onSaveProperty: (updatedProp: AppConfig) => void;
  onCreateProperty: (newProp: AppConfig) => void;
  onDeleteProperty: (appId: string) => void;
  onRunEnvironment?: (appId: string, envId: string, network: 'staging' | 'prod') => void;
}

export const CatchpointEnvironmentStudio: React.FC<
  CatchpointEnvironmentStudioProps
> = ({
  apps,
  activeAppId,
  onSelectProperty,
  onSaveProperty,
  onCreateProperty,
  onDeleteProperty,
  onRunEnvironment,
}) => {
  const activeProp = apps.find((a) => a.id === activeAppId) || apps[0];
  const [propQuery, setPropQuery] = useState('');
  const [editingPropMeta, setEditingPropMeta] = useState(false);
  const [propNameDraft, setPropNameDraft] = useState(activeProp.name);
  const [propDivisionDraft, setPropDivisionDraft] = useState(
    activeProp.division || 'Core Digital'
  );
  const [propSuitePathDraft, setPropSuitePathDraft] = useState(
    activeProp.suitePath
  );

  // New Property creator state
  const [showNewPropForm, setShowNewPropForm] = useState(false);
  const [newPropId, setNewPropId] = useState('');
  const [newPropName, setNewPropName] = useState('');
  const [newPropDivision, setNewPropDivision] = useState('Edge Applications');
  const [newPropHost, setNewPropHost] = useState('');
  const [newPropError, setNewPropError] = useState('');

  // Environment Editor state
  const [editingEnvOrigId, setEditingEnvOrigId] = useState<string | null>(null);
  const [showEnvEditor, setShowEnvEditor] = useState(false);
  const [envDraft, setEnvDraft] = useState<EnvironmentConfig>({
    id: 'qa',
    name: 'QA Canary',
    tier: 'qa',
    description: '',
    hostMap: {
      [resolvePropertyHostname(activeProp.id, 'prod', {
        ...DEFAULT_TEMPLATE_CONFIG,
        properties: apps,
      })]: `${activeProp.id}-qa.salesforce.com`,
    },
    networks: ['staging', 'prod'],
    edgeIps: { staging: '', prod: '' },
    defaultPopId: 'auto',
    headers: {},
    variables: {},
    scheduleIntervalMin: 5,
    alertThresholdMs: 1200,
  });
  const [hostMapRows, setHostMapRows] = useState<Array<{ key: string; value: string }>>([]);
  const [headerRows, setHeaderRows] = useState<Array<{ key: string; value: string }>>([]);
  const [varRows, setVarRows] = useState<Array<{ key: string; value: string }>>([]);
  const [envValidationErrors, setEnvValidationErrors] = useState<Record<string, string>>({});

  React.useEffect(() => {
    setPropNameDraft(activeProp.name);
    setPropDivisionDraft(activeProp.division || 'Core Digital');
    setPropSuitePathDraft(activeProp.suitePath);
    setEditingPropMeta(false);
    setShowEnvEditor(false);
  }, [activeProp.id]);

  const filteredProps = useMemo(() => {
    const q = propQuery.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.division || '').toLowerCase().includes(q)
    );
  }, [apps, propQuery]);

  const openNewEnvEditor = () => {
    const canonicalHost = resolvePropertyHostname(activeProp.id, 'prod', {
      ...DEFAULT_TEMPLATE_CONFIG,
      properties: apps,
    });
    const suggestedId = activeProp.envs.some((e) => e.id === 'qa')
      ? activeProp.envs.some((e) => e.id === 'canary')
        ? `env-${activeProp.envs.length + 1}`
        : 'canary'
      : 'qa';
    const targetHost = canonicalHost.replace(
      /^([a-z0-9-]+)\./,
      `$1-${suggestedId}.`
    );
    setEditingEnvOrigId(null);
    setEnvDraft({
      id: suggestedId,
      name: suggestedId.toUpperCase(),
      tier: suggestedId === 'canary' ? 'canary' : 'qa',
      description: `${activeProp.id} ${suggestedId.toUpperCase()} synthetic environment`,
      hostMap: { [canonicalHost]: targetHost },
      networks: ['staging', 'prod'],
      edgeIps: { staging: '', prod: '' },
      defaultPopId: 'auto',
      headers: {},
      variables: {},
      scheduleIntervalMin: 5,
      alertThresholdMs: 1200,
    });
    setHostMapRows([{ key: canonicalHost, value: targetHost }]);
    setHeaderRows([]);
    setVarRows([]);
    setEnvValidationErrors({});
    setShowEnvEditor(true);
  };

  const openEditEnvEditor = (env: EnvironmentConfig) => {
    setEditingEnvOrigId(env.id);
    setEnvDraft({
      ...env,
      tier: env.tier || (env.id === 'prod' ? 'prod' : 'uat'),
      networks: env.networks || ['staging', 'prod'],
      edgeIps: env.edgeIps || { staging: '', prod: '' },
      defaultPopId: env.defaultPopId || 'auto',
      scheduleIntervalMin: env.scheduleIntervalMin ?? 5,
      alertThresholdMs: env.alertThresholdMs ?? 1200,
    });
    const hRows = Object.entries(env.hostMap || {}).map(([key, value]) => ({
      key,
      value,
    }));
    setHostMapRows(
      hRows.length > 0
        ? hRows
        : [
            {
              key: resolvePropertyHostname(activeProp.id, 'prod', {
                ...DEFAULT_TEMPLATE_CONFIG,
                properties: apps,
              }),
              value: '',
            },
          ]
    );
    setHeaderRows(
      Object.entries(env.headers || {}).map(([key, value]) => ({ key, value }))
    );
    setVarRows(
      Object.entries(env.variables || {}).map(([key, value]) => ({ key, value }))
    );
    setEnvValidationErrors({});
    setShowEnvEditor(true);
  };

  const handleSaveEnvironment = (e: React.FormEvent) => {
    e.preventDefault();
    const nextHostMap: Record<string, string> = {};
    for (const row of hostMapRows) {
      if (row.key.trim() && row.value.trim()) {
        nextHostMap[row.key.trim()] = row.value.trim();
      }
    }
    const nextHeaders: Record<string, string> = {};
    for (const row of headerRows) {
      if (row.key.trim()) {
        nextHeaders[row.key.trim()] = row.value;
      }
    }
    const nextVars: Record<string, string> = {};
    for (const row of varRows) {
      if (row.key.trim()) {
        nextVars[row.key.trim()] = row.value;
      }
    }

    const candidateEnv: EnvironmentConfig = {
      ...envDraft,
      id: envDraft.id.trim().toLowerCase(),
      name: envDraft.name.trim(),
      hostMap: nextHostMap,
      headers: nextHeaders,
      variables: nextVars,
    };

    const validation = validateEnvironmentDraft(candidateEnv);
    if (!validation.valid) {
      setEnvValidationErrors(validation.errors);
      return;
    }

    const duplicate = activeProp.envs.some(
      (existing) =>
        existing.id.toLowerCase() === candidateEnv.id &&
        existing.id.toLowerCase() !== (editingEnvOrigId || '').toLowerCase()
    );
    if (duplicate) {
      setEnvValidationErrors({
        id: `Environment "${candidateEnv.id}" already exists on ${activeProp.id}`,
      });
      return;
    }

    const updatedProp = upsertEnvironmentInApp(
      activeProp,
      candidateEnv,
      editingEnvOrigId || undefined
    );
    onSaveProperty(updatedProp);
    setShowEnvEditor(false);
    setEditingEnvOrigId(null);
  };

  const handleCreatePropertySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = newPropId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!cleanId || !newPropName.trim()) {
      setNewPropError('Property ID and display name are required');
      return;
    }
    if (apps.some((a) => a.id.toLowerCase() === cleanId)) {
      setNewPropError(`Property "${cleanId}" already exists`);
      return;
    }
    const baseHost =
      newPropHost.trim() || `${cleanId}.salesforce.com`;
    const created: AppConfig = {
      id: cleanId,
      name: newPropName.trim(),
      division: newPropDivision.trim() || 'Edge Applications',
      suitePath: `config/suites/${cleanId}.csv`,
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          tier: 'prod',
          hostMap: { [baseHost]: baseHost },
          networks: ['prod', 'staging'],
          scheduleIntervalMin: 5,
          alertThresholdMs: 1000,
        },
        {
          id: 'uat',
          name: 'UAT',
          tier: 'uat',
          hostMap: { [baseHost]: `${cleanId}-uat.salesforce.com` },
          networks: ['prod', 'staging'],
          scheduleIntervalMin: 10,
          alertThresholdMs: 1500,
        },
      ],
    };
    onCreateProperty(created);
    setShowNewPropForm(false);
    setNewPropId('');
    setNewPropName('');
    setNewPropHost('');
    setNewPropError('');
  };

  return (
    <div
      data-testid="catchpoint-env-studio"
      className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full"
    >
      {/* Left Rail: Properties & Divisions */}
      <aside className="lg:col-span-4 xl:col-span-3 rounded-lg border border-border bg-card flex flex-col overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Server className="w-4 h-4 text-sky-500 shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate">
              Properties ({apps.length})
            </span>
          </div>
          <Button
            type="button"
            size="xs"
            data-testid="new-property-btn"
            onClick={() => {
              setShowNewPropForm((prev) => !prev);
              setNewPropError('');
            }}
            className="whitespace-nowrap shrink-0"
          >
            <Plus className="!size-3" />
            New Property
          </Button>
        </div>

        {showNewPropForm && (
          <form
            onSubmit={handleCreatePropertySubmit}
            className="p-3 border-b border-border bg-muted/30 space-y-2 text-xs"
          >
            <div className="font-semibold text-foreground">
              Add Property / Application
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                aria-label="New Property ID"
                placeholder="ID (e.g. billing)"
                value={newPropId}
                onChange={(e) => setNewPropId(e.target.value)}
                className="h-7 rounded border border-input bg-background px-2 font-mono text-xs"
              />
              <input
                type="text"
                aria-label="New Property Division"
                placeholder="Division"
                value={newPropDivision}
                onChange={(e) => setNewPropDivision(e.target.value)}
                className="h-7 rounded border border-input bg-background px-2 text-xs"
              />
            </div>
            <input
              type="text"
              aria-label="New Property Name"
              placeholder="Display name (e.g. Revenue Billing Portal)"
              value={newPropName}
              onChange={(e) => setNewPropName(e.target.value)}
              className="w-full h-7 rounded border border-input bg-background px-2 text-xs"
            />
            <input
              type="text"
              aria-label="Canonical Production Hostname"
              placeholder="Hostname (e.g. billing.salesforce.com)"
              value={newPropHost}
              onChange={(e) => setNewPropHost(e.target.value)}
              className="w-full h-7 rounded border border-input bg-background px-2 font-mono text-xs"
            />
            {newPropError && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400">
                {newPropError}
              </div>
            )}
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setShowNewPropForm(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="xs" data-testid="save-new-property-btn">
                Create Property
              </Button>
            </div>
          </form>
        )}

        <div className="p-2 border-b border-border">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Filter properties"
              placeholder="Search properties…"
              value={propQuery}
              onChange={(e) => setPropQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-2 rounded border border-input bg-background text-xs font-mono"
            />
          </div>
        </div>

        <div className="max-h-[480px] overflow-y-auto divide-y divide-border">
          {filteredProps.map((prop) => {
            const selected = prop.id === activeProp.id;
            return (
              <button
                key={prop.id}
                type="button"
                data-testid={`env-studio-prop-${prop.id}`}
                onClick={() => onSelectProperty(prop.id)}
                className={`w-full px-3 py-2.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                  selected
                    ? 'bg-sky-500/10 text-foreground'
                    : 'hover:bg-muted/40 text-foreground'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono font-bold text-foreground">
                      {prop.id}
                    </span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground truncate text-[11px]">
                      {prop.division || 'Core'}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {prop.name}
                  </div>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground shrink-0">
                  {prop.envs.length} env{prop.envs.length === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Main Workspace: Active Property Metadata + Editable Environment Matrix */}
      <section className="lg:col-span-8 xl:col-span-9 space-y-3 min-w-0">
        {/* Property Details Header */}
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                <span>Property ID: {activeProp.id}</span>
                <span>·</span>
                <span>{activeProp.division || 'Core Digital'}</span>
                <span>·</span>
                <span>{activeProp.suitePath}</span>
              </div>
              <h2 className="text-sm font-semibold text-foreground mt-0.5 truncate">
                {activeProp.name}
              </h2>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setEditingPropMeta((prev) => !prev)}
                className="whitespace-nowrap shrink-0"
              >
                <Edit3 className="!size-3" />
                {editingPropMeta ? 'Close' : 'Edit Property'}
              </Button>
              {apps.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={`Delete property ${activeProp.id}`}
                  onClick={() => onDeleteProperty(activeProp.id)}
                  className="text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="!size-3" />
                  Delete
                </Button>
              )}
              <Button
                type="button"
                size="xs"
                data-testid="add-environment-btn"
                onClick={openNewEnvEditor}
                className="whitespace-nowrap shrink-0"
              >
                <Plus className="!size-3" />
                Add Environment
              </Button>
            </div>
          </div>

          {editingPropMeta && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!propNameDraft.trim()) return;
                onSaveProperty({
                  ...activeProp,
                  name: propNameDraft.trim(),
                  division: propDivisionDraft.trim() || 'Core Digital',
                  suitePath: propSuitePathDraft.trim() || activeProp.suitePath,
                });
                setEditingPropMeta(false);
              }}
              className="pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs"
            >
              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Property Name
                </label>
                <input
                  type="text"
                  value={propNameDraft}
                  onChange={(e) => setPropNameDraft(e.target.value)}
                  className="w-full h-8 rounded border border-input bg-background px-2.5 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Division / Folder Group
                </label>
                <input
                  type="text"
                  value={propDivisionDraft}
                  onChange={(e) => setPropDivisionDraft(e.target.value)}
                  className="w-full h-8 rounded border border-input bg-background px-2.5 text-xs"
                />
              </div>
              <div className="space-y-1 flex flex-col justify-end">
                <label className="font-medium text-foreground block">
                  Suite CSV Path
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={propSuitePathDraft}
                    onChange={(e) => setPropSuitePathDraft(e.target.value)}
                    className="flex-1 h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                  />
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Inline Environment Configurator Form (Add / Edit) */}
        {showEnvEditor && (
          <form
            data-testid="environment-editor-form"
            onSubmit={handleSaveEnvironment}
            className="rounded-lg border border-sky-500/40 bg-card p-4 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {editingEnvOrigId
                    ? `Edit Environment "${editingEnvOrigId.toUpperCase()}" (${activeProp.id})`
                    : `New Environment on ${activeProp.id}`}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Configure target host mappings, edge network selection, origin PoP, custom headers, and alert thresholds.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close Environment Editor"
                onClick={() => setShowEnvEditor(false)}
              >
                <X className="!size-3.5" />
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="env-id-input"
                  className="font-medium text-foreground block"
                >
                  Environment ID
                </label>
                <input
                  id="env-id-input"
                  data-testid="env-id-input"
                  type="text"
                  value={envDraft.id}
                  onChange={(e) =>
                    setEnvDraft((prev) => ({ ...prev, id: e.target.value }))
                  }
                  placeholder="qa"
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
                {envValidationErrors.id && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {envValidationErrors.id}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="env-name-input"
                  className="font-medium text-foreground block"
                >
                  Display Name
                </label>
                <input
                  id="env-name-input"
                  data-testid="env-name-input"
                  type="text"
                  value={envDraft.name}
                  onChange={(e) =>
                    setEnvDraft((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="QA Canary"
                  className="w-full h-8 rounded border border-input bg-background px-2.5 text-xs"
                />
                {envValidationErrors.name && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {envValidationErrors.name}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="env-tier-select"
                  className="font-medium text-foreground block"
                >
                  Environment Tier
                </label>
                <select
                  id="env-tier-select"
                  value={envDraft.tier || 'qa'}
                  onChange={(e) =>
                    setEnvDraft((prev) => ({
                      ...prev,
                      tier: e.target.value as EnvironmentTier,
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="prod">prod (Production)</option>
                  <option value="staging">staging (Pre-Prod)</option>
                  <option value="uat">uat (UAT)</option>
                  <option value="qa">qa (QA Verification)</option>
                  <option value="canary">canary (Canary Ring)</option>
                  <option value="dev">dev (Development)</option>
                  <option value="dr">dr (Disaster Recovery)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="env-pop-select"
                  className="font-medium text-foreground block"
                >
                  Default Catchpoint PoP Node
                </label>
                <select
                  id="env-pop-select"
                  value={envDraft.defaultPopId || 'auto'}
                  onChange={(e) =>
                    setEnvDraft((prev) => ({
                      ...prev,
                      defaultPopId: e.target.value,
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="auto">Auto Regional</option>
                  {GLOBAL_EXECUTION_POPS.map((pop) => (
                    <option key={pop.id} value={pop.id}>
                      {pop.popCode} · {pop.city}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <span className="font-medium text-foreground block">
                  Edge Networks
                </span>
                <div className="flex items-center gap-4 h-8">
                  {(['staging', 'prod'] as const).map((net) => {
                    const checked = (envDraft.networks || []).includes(net);
                    return (
                      <label
                        key={net}
                        className="inline-flex items-center gap-1.5 cursor-pointer font-mono"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const curr = envDraft.networks || [];
                            const next = e.target.checked
                              ? Array.from(new Set([...curr, net]))
                              : curr.filter((n) => n !== net);
                            setEnvDraft((prev) => ({ ...prev, networks: next }));
                          }}
                        />
                        <span>{net}</span>
                      </label>
                    );
                  })}
                </div>
                {envValidationErrors.networks && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {envValidationErrors.networks}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Staging Edge IP Override
                </label>
                <input
                  type="text"
                  placeholder="Auto (e.g. 23.48.201.18)"
                  value={envDraft.edgeIps?.staging || ''}
                  onChange={(e) =>
                    setEnvDraft((prev) => ({
                      ...prev,
                      edgeIps: { ...(prev.edgeIps || {}), staging: e.target.value },
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Production Edge IP Override
                </label>
                <input
                  type="text"
                  placeholder="Auto (e.g. 23.212.251.15)"
                  value={envDraft.edgeIps?.prod || ''}
                  onChange={(e) =>
                    setEnvDraft((prev) => ({
                      ...prev,
                      edgeIps: { ...(prev.edgeIps || {}), prod: e.target.value },
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Interval (m)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={envDraft.scheduleIntervalMin ?? 5}
                    onChange={(e) =>
                      setEnvDraft((prev) => ({
                        ...prev,
                        scheduleIntervalMin: Number(e.target.value) || 5,
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Alert SLA (ms)
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={30000}
                    value={envDraft.alertThresholdMs ?? 1200}
                    onChange={(e) =>
                      setEnvDraft((prev) => ({
                        ...prev,
                        alertThresholdMs: Number(e.target.value) || 1200,
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* HostMap Table */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">
                  HostMap Normalization (Canonical Host → Environment Target Host)
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setHostMapRows((prev) => [...prev, { key: '', value: '' }])
                  }
                >
                  <Plus className="!size-3" />
                  Add Host Mapping
                </Button>
              </div>
              {envValidationErrors.hostMap && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {envValidationErrors.hostMap}
                </p>
              )}
              <div className="space-y-1.5">
                {hostMapRows.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 sm:grid-cols-11 gap-2 items-center"
                  >
                    <input
                      type="text"
                      aria-label={`Canonical Host ${idx + 1}`}
                      placeholder="www.salesforce.com"
                      value={row.key}
                      onChange={(e) =>
                        setHostMapRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, key: e.target.value } : r
                          )
                        )
                      }
                      className="sm:col-span-5 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                    <span className="hidden sm:block text-center text-muted-foreground font-mono">
                      →
                    </span>
                    <input
                      type="text"
                      aria-label={`Target Host ${idx + 1}`}
                      data-testid={`env-target-host-${idx}`}
                      placeholder="www-qa1.salesforce.com"
                      value={row.value}
                      onChange={(e) =>
                        setHostMapRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, value: e.target.value } : r
                          )
                        )
                      }
                      className="sm:col-span-4 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove Host Mapping ${idx + 1}`}
                      onClick={() =>
                        setHostMapRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                      disabled={hostMapRows.length <= 1}
                    >
                      <Trash2 className="!size-3 text-rose-500" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Custom Headers & Environment Variables */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Custom Environment Headers
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setHeaderRows((prev) => [...prev, { key: '', value: '' }])
                    }
                  >
                    <Plus className="!size-3" />
                    Add Header
                  </Button>
                </div>
                {headerRows.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Optional HTTP headers injected for all probes in this environment.
                  </p>
                )}
                {headerRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="X-Env-Ring"
                      value={row.key}
                      onChange={(e) =>
                        setHeaderRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, key: e.target.value } : r
                          )
                        )
                      }
                      className="flex-1 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                    <input
                      type="text"
                      placeholder="canary-ring-1"
                      value={row.value}
                      onChange={(e) =>
                        setHeaderRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, value: e.target.value } : r
                          )
                        )
                      }
                      className="flex-1 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove Header ${idx + 1}`}
                      onClick={() =>
                        setHeaderRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <X className="!size-3" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Environment Variables
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setVarRows((prev) => [...prev, { key: '', value: '' }])
                    }
                  >
                    <Plus className="!size-3" />
                    Add Variable
                  </Button>
                </div>
                {varRows.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Template variables (e.g. REGION_CODE, LOCALE) available to synthetic tests.
                  </p>
                )}
                {varRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="VARIABLE_KEY"
                      value={row.key}
                      onChange={(e) =>
                        setVarRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, key: e.target.value } : r
                          )
                        )
                      }
                      className="flex-1 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) =>
                        setVarRows((prev) =>
                          prev.map((r, i) =>
                            i === idx ? { ...r, value: e.target.value } : r
                          )
                        )
                      }
                      className="flex-1 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove Variable ${idx + 1}`}
                      onClick={() =>
                        setVarRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                    >
                      <X className="!size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowEnvEditor(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                data-testid="save-environment-btn"
              >
                <Check className="!size-3.5" />
                Save Environment
              </Button>
            </div>
          </form>
        )}

        {/* Environments Matrix Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">
              Configured Environments ({activeProp.envs.length})
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">
              Reorder, edit host mappings, headers, edge IPs, or trigger live probes
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20 py-2">Order</TableHead>
                <TableHead className="w-28 py-2">Env / Tier</TableHead>
                <TableHead className="py-2">HostMap Routing</TableHead>
                <TableHead className="w-36 py-2">Networks / PoP</TableHead>
                <TableHead className="w-32 py-2">Schedule & SLA</TableHead>
                <TableHead className="text-right w-44 py-2">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs">
              {activeProp.envs.map((env, idx) => {
                const mappings = Object.entries(env.hostMap || {});
                const nets = env.networks || ['prod', 'staging'];
                return (
                  <TableRow
                    key={env.id}
                    data-testid={`env-row-${activeProp.id}-${env.id}`}
                  >
                    <TableCell className="py-2">
                      <div className="inline-flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={idx === 0}
                          aria-label={`Move environment ${env.id} up`}
                          onClick={() =>
                            onSaveProperty(
                              reorderEnvironmentInApp(activeProp, env.id, 'up')
                            )
                          }
                        >
                          <ArrowUp className="!size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={idx === activeProp.envs.length - 1}
                          aria-label={`Move environment ${env.id} down`}
                          onClick={() =>
                            onSaveProperty(
                              reorderEnvironmentInApp(activeProp, env.id, 'down')
                            )
                          }
                        >
                          <ArrowDown className="!size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="font-mono font-bold text-foreground">
                        {env.name}
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {env.id} · {env.tier || env.id}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-[11px]">
                      {mappings.map(([k, v]) => (
                        <div key={k} className="truncate max-w-[320px]">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="mx-1 text-sky-500">→</span>
                          <span className="text-foreground font-semibold">{v}</span>
                        </div>
                      ))}
                      {env.headers && Object.keys(env.headers).length > 0 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          +{Object.keys(env.headers).length} custom header(s)
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="py-2 font-mono text-[11px] text-muted-foreground">
                      <div>{nets.join(' · ')}</div>
                      <div className="text-[10px]">
                        PoP: {(env.defaultPopId || 'auto').toUpperCase()}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                      <div>Every {env.scheduleIntervalMin ?? 5}m</div>
                      <div>SLA &lt;{env.alertThresholdMs ?? 1200}ms</div>
                    </TableCell>
                    <TableCell className="py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        {onRunEnvironment && nets.includes('staging') && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            aria-label={`Run ${env.id} staging`}
                            title={`Run suite on ${activeProp.id}.${env.id}.staging`}
                            onClick={() =>
                              onRunEnvironment(activeProp.id, env.id, 'staging')
                            }
                          >
                            <Play className="!size-2.5 fill-current text-sky-500" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          data-testid={`edit-env-${env.id}-btn`}
                          onClick={() => openEditEnvEditor(env)}
                          className="whitespace-nowrap shrink-0"
                        >
                          <Edit3 className="!size-3" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={activeProp.envs.length <= 1}
                          aria-label={`Delete environment ${env.id}`}
                          onClick={() => {
                            const res = deleteEnvironmentFromApp(
                              activeProp,
                              env.id
                            );
                            if (res.deleted) onSaveProperty(res.app);
                          }}
                        >
                          <Trash2 className="!size-3 text-rose-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
};

// ============================================================================
// 2. CATCHPOINT UNIVERSAL TEST CONFIGURATOR & FOLDER ORGANIZER STUDIO
// ============================================================================
export interface CatchpointTestStudioProps {
  appId: string;
  apps?: AppConfig[];
  suite: TestCaseDefinition[];
  folders: TestFolder[];
  onSaveSuite: (nextSuite: TestCaseDefinition[]) => void;
  onSaveFolders: (nextFolders: TestFolder[]) => void;
  onRunSingleTest?: (testId: string) => void;
}

export const CatchpointTestStudio: React.FC<CatchpointTestStudioProps> = ({
  appId,
  apps = DEFAULT_TEMPLATE_CONFIG.properties,
  suite,
  folders,
  onSaveSuite,
  onSaveFolders,
  onRunSingleTest,
}) => {
  const normalizedSuite = useMemo(
    () => normalizeSuiteWithCatchpointDefaults(suite),
    [suite]
  );

  const [selectedFolderId, setSelectedFolderId] = useState<string>('ALL');
  const [selectedFamily, setSelectedFamily] = useState<
    CatchpointMonitorFamily | 'ALL'
  >('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [bulkTargetFolderId, setBulkTargetFolderId] = useState<string>(
    folders[0]?.id || 'folder-core'
  );

  // Folder manager state
  const [showNewFolderForm, setShowNewFolderForm] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState('');

  // Test Configurator drawer state
  const [showTestEditor, setShowTestEditor] = useState(false);
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);
  const [typeFilterFamily, setTypeFilterFamily] = useState<
    CatchpointMonitorFamily | 'ALL'
  >('ALL');
  const [testDraft, setTestDraft] = useState<TestCaseDefinition>({
    id: generateNextTestId(normalizedSuite),
    name: '',
    path: '/',
    expectedStatus: '200',
    testType: 'web-chrome',
    folderId: folders[0]?.id || 'folder-core',
    category: 'Core Experience',
    httpMethod: 'GET',
    port: 443,
    scheduleIntervalMin: 5,
    slaWarningMs: 800,
    slaCriticalMs: 2000,
    enabled: true,
    visualGate: 'standard',
  });
  const [testHeaderRows, setTestHeaderRows] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});

  const folderCounts = useMemo(() => {
    const map: Record<string, number> = { ALL: normalizedSuite.length };
    for (const f of folders) map[f.id] = 0;
    for (const t of normalizedSuite) {
      const fId = t.folderId || 'folder-core';
      map[fId] = (map[fId] || 0) + 1;
    }
    return map;
  }, [normalizedSuite, folders]);

  const filteredTests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return normalizedSuite.filter((tc) => {
      if (selectedFolderId !== 'ALL' && tc.folderId !== selectedFolderId) {
        return false;
      }
      const meta = getCatchpointTypeMeta(tc.testType);
      if (selectedFamily !== 'ALL' && meta.family !== selectedFamily) {
        return false;
      }
      if (!q) return true;
      return (
        tc.id.toLowerCase().includes(q) ||
        tc.name.toLowerCase().includes(q) ||
        tc.path.toLowerCase().includes(q) ||
        meta.label.toLowerCase().includes(q) ||
        (tc.targetHost || '').toLowerCase().includes(q) ||
        (tc.category || '').toLowerCase().includes(q)
      );
    });
  }, [normalizedSuite, selectedFolderId, selectedFamily, searchQuery]);

  const openNewTestEditor = (presetType: CatchpointTestType = 'web-chrome') => {
    const meta = getCatchpointTypeMeta(presetType);
    setEditingOriginalId(null);
    setTypeFilterFamily('ALL');
    setTestDraft({
      id: generateNextTestId(normalizedSuite),
      name: '',
      path: presetType === 'api' ? '/api/v1/health' : '/',
      expectedStatus: meta.defaultExpectedStatus,
      testType: presetType,
      monitorEngine: meta.defaultMonitor,
      folderId:
        selectedFolderId !== 'ALL'
          ? selectedFolderId
          : folders[0]?.id || 'folder-core',
      category: meta.familyLabel,
      httpMethod: meta.defaultMethod,
      port: meta.defaultPort,
      dnsRecordType:
        presetType === 'dns-direct' || presetType === 'dns-experience'
          ? 'A'
          : undefined,
      sslMinExpiryDays: presetType === 'ssl' ? 30 : undefined,
      bgpPrefix: presetType === 'bgp' ? '23.48.201.0/24' : undefined,
      bgpOriginAsn: presetType === 'bgp' ? 'AS20940' : undefined,
      transactionSteps:
        presetType === 'transaction-playwright' ||
        presetType === 'transaction-selenium' ||
        presetType === 'playback'
          ? [
              { step: 1, action: 'open', target: '/' },
              { step: 2, action: 'waitForSelector', target: 'main' },
              { step: 3, action: 'assertStatus', target: '/', value: '200' },
            ]
          : undefined,
      assertions: { maxLatencyMs: 2500 },
      scheduleIntervalMin: 5,
      slaWarningMs: 800,
      slaCriticalMs: 2000,
      enabled: true,
      visualGate: 'standard',
    });
    setTestHeaderRows([]);
    setTestErrors({});
    setShowTestEditor(true);
  };

  const openEditTestEditor = (tc: TestCaseDefinition) => {
    setEditingOriginalId(tc.id);
    setTypeFilterFamily('ALL');
    setTestDraft({ ...tc });
    setTestHeaderRows(
      Object.entries(tc.requestHeaders || {}).map(([key, value]) => ({
        key,
        value,
      }))
    );
    setTestErrors({});
    setShowTestEditor(true);
  };

  const handleSelectCatchpointType = (nextType: CatchpointTestType) => {
    const meta = getCatchpointTypeMeta(nextType);
    setTestDraft((prev) => ({
      ...prev,
      testType: nextType,
      monitorEngine: meta.defaultMonitor,
      httpMethod: meta.defaultMethod,
      port: meta.defaultPort,
      expectedStatus:
        editingOriginalId ? prev.expectedStatus : meta.defaultExpectedStatus,
      dnsRecordType:
        nextType === 'dns-direct' || nextType === 'dns-experience'
          ? prev.dnsRecordType || 'A'
          : prev.dnsRecordType,
      sslMinExpiryDays:
        nextType === 'ssl' ? prev.sslMinExpiryDays || 30 : prev.sslMinExpiryDays,
      bgpPrefix:
        nextType === 'bgp' ? prev.bgpPrefix || '23.48.201.0/24' : prev.bgpPrefix,
      bgpOriginAsn:
        nextType === 'bgp' ? prev.bgpOriginAsn || 'AS20940' : prev.bgpOriginAsn,
      transactionSteps:
        (nextType === 'transaction-playwright' ||
          nextType === 'transaction-selenium' ||
          nextType === 'playback') &&
        (!prev.transactionSteps || prev.transactionSteps.length === 0)
          ? [
              { step: 1, action: 'open', target: prev.path || '/' },
              { step: 2, action: 'waitForSelector', target: 'main' },
              { step: 3, action: 'assertStatus', target: prev.path || '/', value: '200' },
            ]
          : prev.transactionSteps,
    }));
  };

  const handleSaveTestSubmit = (
    e: React.FormEvent,
    andRunAfter: boolean = false
  ) => {
    e.preventDefault();
    const validation = validateTestDraft(testDraft);
    if (!validation.valid) {
      setTestErrors(validation.errors);
      return;
    }

    const cleanId = testDraft.id.trim().toUpperCase();
    const duplicate = normalizedSuite.some(
      (t) =>
        t.id.toUpperCase() === cleanId &&
        t.id.toUpperCase() !== (editingOriginalId || '').toUpperCase()
    );
    if (duplicate) {
      setTestErrors({
        id: `Test ID "${cleanId}" already exists in this suite`,
      });
      return;
    }

    const headerMap: Record<string, string> = {};
    for (const row of testHeaderRows) {
      if (row.key.trim()) {
        headerMap[row.key.trim()] = row.value;
      }
    }

    const nextSuite = upsertTestInSuite(
      normalizedSuite,
      {
        ...testDraft,
        id: cleanId,
        requestHeaders: Object.keys(headerMap).length > 0 ? headerMap : undefined,
      },
      editingOriginalId || undefined
    );

    onSaveSuite(nextSuite);
    setShowTestEditor(false);
    setEditingOriginalId(null);
    if (andRunAfter && onRunSingleTest) {
      setTimeout(() => onRunSingleTest(cleanId), 50);
    }
  };

  const activeTypeMeta = getCatchpointTypeMeta(testDraft.testType);
  const selectableTypes = useMemo(() => {
    if (typeFilterFamily === 'ALL') return CATCHPOINT_TEST_TYPES;
    return CATCHPOINT_TEST_TYPES.filter((t) => t.family === typeFilterFamily);
  }, [typeFilterFamily]);

  return (
    <div
      data-testid="catchpoint-test-studio"
      className="grid grid-cols-1 lg:grid-cols-12 gap-4 w-full"
    >
      {/* Left Organizer Rail: Folders & Catchpoint Monitor Families */}
      <aside className="lg:col-span-3 rounded-lg border border-border bg-card flex flex-col overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-border bg-muted/20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <Folder className="w-4 h-4 text-sky-500 shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate">
              Test Folders
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="new-folder-btn"
            onClick={() => setShowNewFolderForm((prev) => !prev)}
            className="whitespace-nowrap shrink-0"
          >
            <FolderPlus className="!size-3" />
            New Folder
          </Button>
        </div>

        {showNewFolderForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newFolderName.trim()) return;
              const nextFolders = upsertFolder(folders, {
                id: '',
                name: newFolderName.trim(),
                description: newFolderDesc.trim(),
                color: 'sky',
              });
              onSaveFolders(nextFolders);
              setNewFolderName('');
              setNewFolderDesc('');
              setShowNewFolderForm(false);
            }}
            className="p-3 border-b border-border bg-muted/30 space-y-2 text-xs"
          >
            <input
              type="text"
              aria-label="Folder Name"
              data-testid="new-folder-name-input"
              placeholder="Folder name (e.g. Edge Security & DNS)"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full h-7 rounded border border-input bg-background px-2 text-xs"
            />
            <input
              type="text"
              aria-label="Folder Description"
              placeholder="Description (optional)"
              value={newFolderDesc}
              onChange={(e) => setNewFolderDesc(e.target.value)}
              className="w-full h-7 rounded border border-input bg-background px-2 text-xs"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setShowNewFolderForm(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="xs" data-testid="save-folder-btn">
                Create Folder
              </Button>
            </div>
          </form>
        )}

        <div className="divide-y divide-border">
          <button
            type="button"
            onClick={() => setSelectedFolderId('ALL')}
            className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between cursor-pointer transition-colors ${
              selectedFolderId === 'ALL'
                ? 'bg-sky-500/10 font-semibold text-foreground'
                : 'hover:bg-muted/40 text-foreground'
            }`}
          >
            <span className="truncate">All Tests ({appId})</span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {folderCounts.ALL}
            </span>
          </button>

          {folders.map((folder) => {
            const selected = selectedFolderId === folder.id;
            const isRenaming = renamingFolderId === folder.id;
            return (
              <div
                key={folder.id}
                className={`px-3 py-2 text-xs transition-colors ${
                  selected ? 'bg-sky-500/10' : 'hover:bg-muted/40'
                }`}
              >
                {isRenaming ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!renameFolderDraft.trim()) return;
                      onSaveFolders(
                        upsertFolder(folders, {
                          ...folder,
                          name: renameFolderDraft.trim(),
                        })
                      );
                      setRenamingFolderId(null);
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="text"
                      value={renameFolderDraft}
                      onChange={(e) => setRenameFolderDraft(e.target.value)}
                      className="flex-1 h-6 rounded border border-input bg-background px-1.5 text-xs"
                    />
                    <Button type="submit" size="icon-xs" aria-label="Confirm rename">
                      <Check className="!size-3" />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center justify-between gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedFolderId(folder.id)}
                      className="flex-1 min-w-0 text-left flex items-center gap-1.5 cursor-pointer"
                    >
                      <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span
                        className={`truncate ${
                          selected ? 'font-semibold text-foreground' : 'text-foreground'
                        }`}
                      >
                        {folder.name}
                      </span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {folderCounts[folder.id] || 0}
                      </span>
                      <button
                        type="button"
                        aria-label={`Rename folder ${folder.name}`}
                        onClick={() => {
                          setRenamingFolderId(folder.id);
                          setRenameFolderDraft(folder.name);
                        }}
                        className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      {folders.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Delete folder ${folder.name}`}
                          onClick={() => {
                            const next = deleteFolderAndReassign(
                              folders,
                              normalizedSuite,
                              folder.id
                            );
                            onSaveFolders(next.folders);
                            onSaveSuite(next.suite);
                            if (selectedFolderId === folder.id) {
                              setSelectedFolderId('ALL');
                            }
                          }}
                          className="p-0.5 text-muted-foreground hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Monitor Type Family Filter */}
        <div className="p-3 border-t border-border bg-muted/10 space-y-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground">
            Catchpoint Monitor Families ({CATCHPOINT_TEST_TYPES.length} types)
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setSelectedFamily('ALL')}
              className={`px-2 py-1 rounded text-left text-xs cursor-pointer ${
                selectedFamily === 'ALL'
                  ? 'bg-foreground text-background font-semibold'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              All Monitor Families
            </button>
            {CATCHPOINT_FAMILY_META.map((fam) => {
              const count = normalizedSuite.filter(
                (t) => getCatchpointTypeMeta(t.testType).family === fam.id
              ).length;
              return (
                <button
                  key={fam.id}
                  type="button"
                  onClick={() => setSelectedFamily(fam.id)}
                  className={`px-2 py-1 rounded text-left text-xs flex items-center justify-between cursor-pointer ${
                    selectedFamily === fam.id
                      ? 'bg-sky-500 text-zinc-950 font-semibold'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <span>{fam.label}</span>
                  <span className="font-mono text-[11px] tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      {/* Main Content: Test List + Inline Configurator Drawer */}
      <section className="lg:col-span-9 space-y-3 min-w-0">
        {/* Top Action Toolbar */}
        <div className="rounded-lg border border-border bg-card p-3 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                aria-label="Search Catchpoint tests"
                placeholder="Search ID, name, path, protocol…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-2.5 rounded border border-input bg-background text-xs font-mono w-64"
              />
            </div>

            {selectedTestIds.length > 0 && (
              <div className="flex items-center gap-1.5 pl-2 border-l border-border">
                <span className="font-mono text-[11px] text-foreground font-semibold">
                  {selectedTestIds.length} selected
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    onSaveSuite(
                      toggleTestsEnabled(normalizedSuite, selectedTestIds, true)
                    )
                  }
                >
                  Enable
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    onSaveSuite(
                      toggleTestsEnabled(normalizedSuite, selectedTestIds, false)
                    )
                  }
                >
                  Pause
                </Button>
                <select
                  aria-label="Move selected tests to folder"
                  value={bulkTargetFolderId}
                  onChange={(e) => {
                    const targetF = e.target.value;
                    setBulkTargetFolderId(targetF);
                    onSaveSuite(
                      moveTestsToFolder(normalizedSuite, selectedTestIds, targetF)
                    );
                  }}
                  className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      Move → {f.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    onSaveSuite(
                      deleteTestsFromSuite(normalizedSuite, selectedTestIds)
                    );
                    setSelectedTestIds([]);
                  }}
                  className="text-rose-600 dark:text-rose-400"
                >
                  Delete
                </Button>
              </div>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            data-testid="new-catchpoint-test-btn"
            onClick={() => openNewTestEditor('web-chrome')}
            className="whitespace-nowrap shrink-0"
          >
            <Plus className="!size-3.5" />
            New Catchpoint Test
          </Button>
        </div>

        {/* Full Catchpoint Test Configurator Form */}
        {showTestEditor && (
          <form
            data-testid="catchpoint-test-editor-form"
            onSubmit={(e) => handleSaveTestSubmit(e, false)}
            className="rounded-lg border border-sky-500/40 bg-card p-4 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between pb-2.5 border-b border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {editingOriginalId
                    ? `Configure Test ${editingOriginalId}`
                    : 'Create Catchpoint Synthetic Test'}
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Supports all {CATCHPOINT_TEST_TYPES.length} Catchpoint monitor types, custom HTTP/protocol settings, multi-step scripts, folders, and SLAs.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close Test Configurator"
                onClick={() => setShowTestEditor(false)}
              >
                <X className="!size-3.5" />
              </Button>
            </div>

            {/* Step 1: Catchpoint Test Type Picker */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-semibold text-foreground">
                  1. Catchpoint Test Type ({CATCHPOINT_TEST_TYPES.length} Supported Types)
                </label>
                <div className="inline-flex items-center rounded border border-border bg-muted/30 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setTypeFilterFamily('ALL')}
                    className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                      typeFilterFamily === 'ALL'
                        ? 'bg-foreground text-background font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All ({CATCHPOINT_TEST_TYPES.length})
                  </button>
                  {CATCHPOINT_FAMILY_META.map((fam) => (
                    <button
                      key={fam.id}
                      type="button"
                      onClick={() => setTypeFilterFamily(fam.id)}
                      className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                        typeFilterFamily === fam.id
                          ? 'bg-sky-500 text-zinc-950 font-semibold'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {fam.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5 max-h-44 overflow-y-auto p-1.5 rounded border border-border bg-muted/10">
                {selectableTypes.map((cpType) => {
                  const active = (testDraft.testType || 'web-chrome') === cpType.type;
                  return (
                    <button
                      key={cpType.type}
                      type="button"
                      data-testid={`catchpoint-type-opt-${cpType.type}`}
                      onClick={() => handleSelectCatchpointType(cpType.type)}
                      className={`px-2.5 py-2 rounded border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-sky-500 bg-sky-500/15 text-foreground font-semibold'
                          : 'border-border bg-background hover:bg-muted/40 text-foreground'
                      }`}
                    >
                      <div className="text-[11px] truncate">{cpType.shortLabel}</div>
                      <div className="font-mono text-[10px] text-muted-foreground truncate">
                        {cpType.defaultProtocol}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] text-muted-foreground bg-muted/20 px-2.5 py-1.5 rounded border border-border">
                <strong className="text-foreground">{activeTypeMeta.label}:</strong>{' '}
                {activeTypeMeta.description}
              </div>
            </div>

            {/* Step 2: Identity & Folder Organization */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-border">
              <div className="space-y-1">
                <label htmlFor="cp-test-id" className="font-medium text-foreground block">
                  Test ID
                </label>
                <input
                  id="cp-test-id"
                  data-testid="cp-test-id-input"
                  type="text"
                  value={testDraft.id}
                  onChange={(e) =>
                    setTestDraft((prev) => ({ ...prev, id: e.target.value }))
                  }
                  placeholder="T09"
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
                {testErrors.id && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {testErrors.id}
                  </p>
                )}
              </div>

              <div className="space-y-1 lg:col-span-2">
                <label htmlFor="cp-test-name" className="font-medium text-foreground block">
                  Test Name
                </label>
                <input
                  id="cp-test-name"
                  data-testid="cp-test-name-input"
                  type="text"
                  value={testDraft.name}
                  onChange={(e) =>
                    setTestDraft((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="e.g. Authoritative Edge DNS & TLS Check"
                  className="w-full h-8 rounded border border-input bg-background px-2.5 text-xs"
                />
                {testErrors.name && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {testErrors.name}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="cp-test-folder" className="font-medium text-foreground block">
                  Folder
                </label>
                <select
                  id="cp-test-folder"
                  data-testid="cp-test-folder-select"
                  value={testDraft.folderId || folders[0]?.id || 'folder-core'}
                  onChange={(e) =>
                    setTestDraft((prev) => ({ ...prev, folderId: e.target.value }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 text-xs"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Step 3: Endpoint / Protocol Parameters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-border">
              <div className="space-y-1 lg:col-span-2">
                <label htmlFor="cp-test-path" className="font-medium text-foreground block">
                  URL Path / Resource
                </label>
                <input
                  id="cp-test-path"
                  data-testid="cp-test-path-input"
                  type="text"
                  value={testDraft.path}
                  onChange={(e) =>
                    setTestDraft((prev) => ({ ...prev, path: e.target.value }))
                  }
                  placeholder="/api/v1/health"
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
                {testErrors.path && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">
                    {testErrors.path}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="cp-test-host" className="font-medium text-foreground block">
                  Target Host Override (Optional)
                </label>
                <input
                  id="cp-test-host"
                  type="text"
                  value={testDraft.targetHost || ''}
                  onChange={(e) =>
                    setTestDraft((prev) => ({ ...prev, targetHost: e.target.value }))
                  }
                  placeholder={`Default (${resolvePropertyHostname(appId, 'prod', {
                    ...DEFAULT_TEMPLATE_CONFIG,
                    properties: apps,
                  })})`}
                  className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">Method</label>
                  <select
                    value={testDraft.httpMethod || 'GET'}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        httpMethod: e.target.value as TestCaseDefinition['httpMethod'],
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                  >
                    {['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'].map(
                      (m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-foreground block">Port</label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={testDraft.port ?? activeTypeMeta.defaultPort}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        port: Number(e.target.value) || activeTypeMeta.defaultPort,
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
            </div>

            {/* Type-specific Conditional Controls (DNS / SSL / BGP / Transaction Steps) */}
            {activeTypeMeta.configSections.includes('dns') && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded border border-border bg-muted/15">
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    DNS Record Type
                  </label>
                  <select
                    data-testid="cp-dns-record-select"
                    value={testDraft.dnsRecordType || 'A'}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        dnsRecordType: e.target.value as TestCaseDefinition['dnsRecordType'],
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                  >
                    {['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'].map(
                      (rec) => (
                        <option key={rec} value={rec}>
                          {rec} Record
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Authoritative / Recursive Nameserver
                  </label>
                  <input
                    type="text"
                    value={testDraft.dnsServer || ''}
                    onChange={(e) =>
                      setTestDraft((prev) => ({ ...prev, dnsServer: e.target.value }))
                    }
                    placeholder="Auto Edge / 1.1.1.1 / ns1.akam.net"
                    className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(testDraft.assertions?.requireDnssec)}
                      onChange={(e) =>
                        setTestDraft((prev) => ({
                          ...prev,
                          assertions: {
                            ...(prev.assertions || {}),
                            requireDnssec: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span className="font-medium text-foreground">
                      Require Validated DNSSEC Chain
                    </span>
                  </label>
                </div>
              </div>
            )}

            {activeTypeMeta.configSections.includes('ssl') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded border border-border bg-muted/15">
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Minimum Certificate Expiry Days
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={testDraft.sslMinExpiryDays ?? 30}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        sslMinExpiryDays: Number(e.target.value) || 30,
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Minimum TLS Protocol Version
                  </label>
                  <select
                    value={testDraft.assertions?.minTlsVersion || 'TLSv1.2'}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        assertions: {
                          ...(prev.assertions || {}),
                          minTlsVersion: e.target.value,
                        },
                      }))
                    }
                    className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                  >
                    <option value="TLSv1.3">TLSv1.3 Only</option>
                    <option value="TLSv1.2">TLSv1.2 or higher</option>
                  </select>
                </div>
              </div>
            )}

            {activeTypeMeta.configSections.includes('bgp') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded border border-border bg-muted/15">
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Announced Prefix (CIDR)
                  </label>
                  <input
                    type="text"
                    value={testDraft.bgpPrefix || ''}
                    onChange={(e) =>
                      setTestDraft((prev) => ({ ...prev, bgpPrefix: e.target.value }))
                    }
                    placeholder="23.48.201.0/24"
                    className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-medium text-foreground block">
                    Expected Origin ASN
                  </label>
                  <input
                    type="text"
                    value={testDraft.bgpOriginAsn || ''}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        bgpOriginAsn: e.target.value,
                      }))
                    }
                    placeholder="AS20940"
                    className="w-full h-8 rounded border border-input bg-background px-2.5 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {activeTypeMeta.configSections.includes('transaction') && (
              <div className="space-y-2 p-3 rounded border border-border bg-muted/15">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    Multi-Step Transaction Script
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setTestDraft((prev) => ({
                        ...prev,
                        transactionSteps: [
                          ...(prev.transactionSteps || []),
                          {
                            step: (prev.transactionSteps?.length || 0) + 1,
                            action: 'click',
                            target: 'button[type="submit"]',
                          },
                        ],
                      }))
                    }
                  >
                    <Plus className="!size-3" />
                    Add Step
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {(testDraft.transactionSteps || []).map((st, sIdx) => (
                    <div
                      key={sIdx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-1.5 items-center"
                    >
                      <span className="sm:col-span-1 font-mono text-muted-foreground">
                        #{sIdx + 1}
                      </span>
                      <select
                        value={st.action}
                        onChange={(e) =>
                          setTestDraft((prev) => ({
                            ...prev,
                            transactionSteps: (prev.transactionSteps || []).map(
                              (item, i) =>
                                i === sIdx
                                  ? {
                                      ...item,
                                      action: e.target
                                        .value as TransactionStep['action'],
                                    }
                                  : item
                            ),
                          }))
                        }
                        className="sm:col-span-3 h-7 rounded border border-input bg-background px-1.5 font-mono text-xs"
                      >
                        <option value="open">open</option>
                        <option value="click">click</option>
                        <option value="type">type</option>
                        <option value="waitForSelector">waitForSelector</option>
                        <option value="assertText">assertText</option>
                        <option value="assertStatus">assertStatus</option>
                        <option value="screenshot">screenshot</option>
                      </select>
                      <input
                        type="text"
                        placeholder="Selector or URL"
                        value={st.target}
                        onChange={(e) =>
                          setTestDraft((prev) => ({
                            ...prev,
                            transactionSteps: (prev.transactionSteps || []).map(
                              (item, i) =>
                                i === sIdx ? { ...item, target: e.target.value } : item
                            ),
                          }))
                        }
                        className="sm:col-span-4 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Value / assertion (optional)"
                        value={st.value || ''}
                        onChange={(e) =>
                          setTestDraft((prev) => ({
                            ...prev,
                            transactionSteps: (prev.transactionSteps || []).map(
                              (item, i) =>
                                i === sIdx ? { ...item, value: e.target.value } : item
                            ),
                          }))
                        }
                        className="sm:col-span-3 h-7 rounded border border-input bg-background px-2 font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete step ${sIdx + 1}`}
                        onClick={() =>
                          setTestDraft((prev) => ({
                            ...prev,
                            transactionSteps: (prev.transactionSteps || []).filter(
                              (_, i) => i !== sIdx
                            ),
                          }))
                        }
                      >
                        <X className="!size-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 4: Assertions, SLA Thresholds & Custom Headers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-border">
              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Expected Status
                </label>
                <input
                  type="text"
                  value={testDraft.expectedStatus}
                  onChange={(e) =>
                    setTestDraft((prev) => ({
                      ...prev,
                      expectedStatus: e.target.value,
                    }))
                  }
                  placeholder="200"
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Interval (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={testDraft.scheduleIntervalMin ?? 5}
                  onChange={(e) =>
                    setTestDraft((prev) => ({
                      ...prev,
                      scheduleIntervalMin: Number(e.target.value) || 5,
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  SLA Warning (ms)
                </label>
                <input
                  type="number"
                  min={50}
                  value={testDraft.slaWarningMs ?? 800}
                  onChange={(e) =>
                    setTestDraft((prev) => ({
                      ...prev,
                      slaWarningMs: Number(e.target.value) || 800,
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  SLA Critical (ms)
                </label>
                <input
                  type="number"
                  min={50}
                  value={testDraft.slaCriticalMs ?? 2000}
                  onChange={(e) =>
                    setTestDraft((prev) => ({
                      ...prev,
                      slaCriticalMs: Number(e.target.value) || 2000,
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs tabular-nums"
                />
              </div>

              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Visual Gate Mode
                </label>
                <select
                  value={
                    typeof testDraft.visualGate === 'string'
                      ? testDraft.visualGate
                      : testDraft.visualGate === false
                      ? 'none'
                      : 'standard'
                  }
                  onChange={(e) =>
                    setTestDraft((prev) => ({
                      ...prev,
                      visualGate: e.target.value === 'none' ? false : e.target.value,
                    }))
                  }
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="standard">Standard AI Diff</option>
                  <option value="strict">Strict Zero-Shift</option>
                  <option value="none">HTTP Only (Skip AI)</option>
                </select>
              </div>
            </div>

            {activeTypeMeta.configSections.includes('body') && (
              <div className="space-y-1">
                <label className="font-medium text-foreground block">
                  Request Payload Body (JSON / XML / MQTT)
                </label>
                <textarea
                  rows={2}
                  value={testDraft.requestBody || ''}
                  onChange={(e) =>
                    setTestDraft((prev) => ({ ...prev, requestBody: e.target.value }))
                  }
                  placeholder='{"query":"query { health { status } }"}'
                  className="w-full rounded border border-input bg-background p-2 font-mono text-xs"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={testDraft.enabled !== false}
                    onChange={(e) =>
                      setTestDraft((prev) => ({ ...prev, enabled: e.target.checked }))
                    }
                  />
                  <span>Enabled</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(testDraft.critical)}
                    onChange={(e) =>
                      setTestDraft((prev) => ({
                        ...prev,
                        critical: e.target.checked,
                      }))
                    }
                  />
                  <span>Release Blocker (Critical)</span>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowTestEditor(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  data-testid="save-catchpoint-test-btn"
                >
                  <Check className="!size-3.5" />
                  Save Test
                </Button>
                {onRunSingleTest && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={(e) => handleSaveTestSubmit(e, true)}
                  >
                    <Play className="!size-3 fill-current" />
                    Save & Run Check
                  </Button>
                )}
              </div>
            </div>
          </form>
        )}

        {/* Organizable Test Inventory Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">
              Showing {filteredTests.length} of {normalizedSuite.length} tests ({appId})
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">
              Click Edit to modify monitor type or assertions · Reorder or assign folders inline
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all visible tests"
                    checked={
                      filteredTests.length > 0 &&
                      filteredTests.every((t) => selectedTestIds.includes(t.id))
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTestIds(filteredTests.map((t) => t.id));
                      } else {
                        setSelectedTestIds([]);
                      }
                    }}
                  />
                </TableHead>
                <TableHead className="w-16 py-2">Order</TableHead>
                <TableHead className="w-32 py-2">Type</TableHead>
                <TableHead className="py-2">Test Name & Target</TableHead>
                <TableHead className="w-40 py-2">Folder</TableHead>
                <TableHead className="w-28 py-2">Schedule / SLA</TableHead>
                <TableHead className="w-16 py-2">Active</TableHead>
                <TableHead className="text-right w-36 py-2">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs">
              {filteredTests.map((tc, idx) => {
                const typeMeta = getCatchpointTypeMeta(tc.testType);
                const checked = selectedTestIds.includes(tc.id);
                return (
                  <TableRow
                    key={tc.id}
                    data-testid={`studio-test-row-${tc.id}`}
                    className={tc.enabled === false ? 'opacity-60' : ''}
                  >
                    <TableCell className="py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select test ${tc.id}`}
                        checked={checked}
                        onChange={(e) => {
                          setSelectedTestIds((prev) =>
                            e.target.checked
                              ? [...prev, tc.id]
                              : prev.filter((id) => id !== tc.id)
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="inline-flex items-center gap-0.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={idx === 0}
                          aria-label={`Move ${tc.id} up`}
                          onClick={() =>
                            onSaveSuite(reorderTestInSuite(normalizedSuite, tc.id, 'up'))
                          }
                        >
                          <ArrowUp className="!size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          disabled={idx === filteredTests.length - 1}
                          aria-label={`Move ${tc.id} down`}
                          onClick={() =>
                            onSaveSuite(
                              reorderTestInSuite(normalizedSuite, tc.id, 'down')
                            )
                          }
                        >
                          <ArrowDown className="!size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="font-mono font-semibold text-foreground">
                        {typeMeta.shortLabel}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {tc.httpMethod || typeMeta.defaultMethod} · {tc.expectedStatus}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-foreground">
                          {tc.id}
                        </span>
                        <span className="font-medium text-foreground truncate max-w-[240px]">
                          {tc.name}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-sky-600 dark:text-sky-400 truncate max-w-[300px]">
                        {tc.targetHost ? `${tc.targetHost}${tc.path}` : tc.path}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <select
                        aria-label={`Folder for ${tc.id}`}
                        value={tc.folderId || folders[0]?.id || 'folder-core'}
                        onChange={(e) =>
                          onSaveSuite(
                            moveTestsToFolder(normalizedSuite, [tc.id], e.target.value)
                          )
                        }
                        className="w-full h-7 rounded border border-input bg-background px-1.5 text-[11px]"
                      >
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                      <div>Every {tc.scheduleIntervalMin ?? 5}m</div>
                      <div>&lt;{tc.slaWarningMs ?? 800}ms</div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Switch
                        aria-label={`Toggle test ${tc.id} active`}
                        checked={tc.enabled !== false}
                        onCheckedChange={(val) =>
                          onSaveSuite(
                            toggleTestsEnabled(normalizedSuite, [tc.id], val)
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="py-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        {onRunSingleTest && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-xs"
                            aria-label={`Run test ${tc.id}`}
                            onClick={() => onRunSingleTest(tc.id)}
                          >
                            <Play className="!size-2.5 fill-current text-sky-500" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          data-testid={`edit-test-${tc.id}-btn`}
                          onClick={() => openEditTestEditor(tc)}
                        >
                          <Edit3 className="!size-3" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Clone test ${tc.id}`}
                          onClick={() => {
                            const cloned = cloneTestInSuite(normalizedSuite, tc.id);
                            onSaveSuite(cloned.suite);
                          }}
                        >
                          <Copy className="!size-3" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete test ${tc.id}`}
                          disabled={normalizedSuite.length <= 1}
                          onClick={() =>
                            onSaveSuite(
                              deleteTestsFromSuite(normalizedSuite, [tc.id])
                            )
                          }
                        >
                          <Trash2 className="!size-3 text-rose-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}

              {filteredTests.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No tests match the active folder or filter.{' '}
                    <button
                      type="button"
                      onClick={() => openNewTestEditor('web-chrome')}
                      className="text-sky-600 dark:text-sky-400 underline font-medium cursor-pointer"
                    >
                      Create a new Catchpoint test
                    </button>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
};
