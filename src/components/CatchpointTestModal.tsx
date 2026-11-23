import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  CATCHPOINT_FAMILY_META,
  CATCHPOINT_TEST_TYPES,
  DEFAULT_TEST_FOLDERS,
  getCatchpointTypeMeta,
  normalizeTestCaseWithCatchpointDefaults,
  validateTestDraft,
} from '../engine/catchpointCatalog';
import { CATCHPOINT_TEST_PRESETS } from '../engine/complexTestEngine';
import {
  SCRIPT_ENGINE_LIST,
  generateDefaultScriptForTest,
  getScriptEngineMeta,
  inferScriptEngineForTest,
  parseScriptToSteps,
} from '../engine/scriptTemplates';
import {
  CatchpointTestType,
  ScriptExecutionResult,
  TestAssertions,
  TestScriptEngine,
  TransactionStep,
} from '../engine/types';
import { TestCaseDefinition } from '../config/template.config';

export interface CatchpointTestModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialDraft: TestCaseDefinition;
  originalId?: string;
  onClose: () => void;
  onSave: (draft: TestCaseDefinition, originalId?: string) => void;
}

const HTTP_METHODS: Array<NonNullable<TestCaseDefinition['httpMethod']>> = [
  'GET',
  'POST',
  'PUT',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'QUERY',
];

const STEP_ACTIONS: Array<TransactionStep['action']> = [
  'open',
  'waitForSelector',
  'click',
  'type',
  'assertText',
  'assertStatus',
  'screenshot',
];

const DNS_RECORD_TYPES: Array<NonNullable<TestCaseDefinition['dnsRecordType']>> = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'TXT',
  'NS',
  'SRV',
  'CAA',
];

export const CatchpointTestModal: React.FC<CatchpointTestModalProps> = ({
  open,
  mode,
  initialDraft,
  originalId,
  onClose,
  onSave,
}) => {
  const [draft, setDraft] = useState<TestCaseDefinition>(() =>
    normalizeTestCaseWithCatchpointDefaults(initialDraft)
  );
  const [headerRows, setHeaderRows] = useState<Array<{ key: string; value: string }>>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [runningScript, setRunningScript] = useState(false);
  const [scriptRunResult, setScriptRunResult] = useState<ScriptExecutionResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const norm = normalizeTestCaseWithCatchpointDefaults(initialDraft);
    setDraft(norm);
    const entries = Object.entries(norm.requestHeaders || {}).map(([key, value]) => ({
      key,
      value,
    }));
    setHeaderRows(entries);
    setErrors({});
    setScriptRunResult(null);
  }, [open, initialDraft]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const typeMeta = getCatchpointTypeMeta(draft.testType);
  const sections = new Set(typeMeta.configSections);

  const handleChangeTestType = (nextType: CatchpointTestType) => {
    const nextMeta = getCatchpointTypeMeta(nextType);
    setDraft((prev) => ({
      ...prev,
      testType: nextType,
      monitorEngine: nextMeta.defaultMonitor,
      httpMethod: nextMeta.defaultMethod || prev.httpMethod || 'GET',
      port: nextMeta.defaultPort,
      expectedStatus: prev.expectedStatus || nextMeta.defaultExpectedStatus,
      dnsRecordType:
        nextType === 'dns-direct' || nextType === 'dns-experience'
          ? prev.dnsRecordType || 'A'
          : prev.dnsRecordType,
      dnsServer:
        nextType === 'dns-direct' || nextType === 'dns-experience'
          ? prev.dnsServer || '8.8.8.8'
          : prev.dnsServer,
      sslMinExpiryDays:
        nextType === 'ssl' ? prev.sslMinExpiryDays ?? 30 : prev.sslMinExpiryDays,
      transactionSteps:
        (nextType === 'transaction-playwright' ||
          nextType === 'transaction-selenium' ||
          nextType === 'playback') &&
        (!prev.transactionSteps || prev.transactionSteps.length === 0)
          ? [
              { step: 1, action: 'open', target: prev.path || '/' },
              { step: 2, action: 'waitForSelector', target: 'main, form, h1' },
              {
                step: 3,
                action: 'assertStatus',
                target: prev.path || '/',
                value: prev.expectedStatus || '200',
              },
              { step: 4, action: 'screenshot', target: '1280x760' },
            ]
          : prev.transactionSteps,
    }));
  };

  const applyPreset = (presetId: string) => {
    const preset = CATCHPOINT_TEST_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const merged = normalizeTestCaseWithCatchpointDefaults({
      ...draft,
      ...preset.template,
      id: draft.id,
    });
    setDraft(merged);
    const entries = Object.entries(merged.requestHeaders || {}).map(([key, value]) => ({
      key,
      value,
    }));
    setHeaderRows(entries);
    setErrors({});
  };

  const updateAssertion = <K extends keyof TestAssertions>(
    key: K,
    val: TestAssertions[K]
  ) => {
    setDraft((prev) => ({
      ...prev,
      assertions: {
        ...(prev.assertions || {}),
        [key]: val,
      },
    }));
  };

  const steps = draft.transactionSteps || [];

  const handleAddStep = () => {
    const nextStep: TransactionStep = {
      step: steps.length + 1,
      action: 'waitForSelector',
      target: 'main',
    };
    setDraft((prev) => ({
      ...prev,
      transactionSteps: [...(prev.transactionSteps || []), nextStep].map((s, i) => ({
        ...s,
        step: i + 1,
      })),
    }));
  };

  const handleUpdateStep = (idx: number, patch: Partial<TransactionStep>) => {
    setDraft((prev) => ({
      ...prev,
      transactionSteps: (prev.transactionSteps || []).map((s, i) =>
        i === idx ? { ...s, ...patch, step: i + 1 } : s
      ),
    }));
  };

  const handleMoveStep = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= steps.length) return;
    const next = [...steps];
    const [moved] = next.splice(idx, 1);
    next.splice(targetIdx, 0, moved);
    setDraft((prev) => ({
      ...prev,
      transactionSteps: next.map((s, i) => ({ ...s, step: i + 1 })),
    }));
  };

  const handleRemoveStep = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      transactionSteps: (prev.transactionSteps || [])
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step: i + 1 })),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanHeaders: Record<string, string> = {};
    for (const row of headerRows) {
      const k = row.key.trim();
      if (k) cleanHeaders[k] = row.value;
    }

    const cleanAssertions: TestAssertions = { ...(draft.assertions || {}) };
    if (!cleanAssertions.expectedBodyMatch?.trim()) {
      delete cleanAssertions.expectedBodyMatch;
    }
    if (!cleanAssertions.maxLatencyMs || cleanAssertions.maxLatencyMs <= 0) {
      delete cleanAssertions.maxLatencyMs;
    }
    if (!cleanAssertions.minTlsVersion?.trim()) {
      delete cleanAssertions.minTlsVersion;
    }
    if (!cleanAssertions.maxHops || cleanAssertions.maxHops <= 0) {
      delete cleanAssertions.maxHops;
    }

    const activeEngine = draft.scriptEngine || inferScriptEngineForTest(draft);
    const candidate: TestCaseDefinition = {
      ...draft,
      scriptEngine: draft.customScript?.trim() ? activeEngine : draft.scriptEngine,
      customScript: draft.customScript?.trim() ? draft.customScript : undefined,
      scriptTimeoutMs: draft.scriptTimeoutMs || 15000,
      requestHeaders: Object.keys(cleanHeaders).length > 0 ? cleanHeaders : undefined,
      requestBody: draft.requestBody?.trim() ? draft.requestBody : undefined,
      assertions:
        Object.keys(cleanAssertions).length > 0 ? cleanAssertions : undefined,
    };

    const validation = validateTestDraft(candidate);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    onSave(candidate, originalId);
  };

  const activeScriptEngine: TestScriptEngine =
    draft.scriptEngine || inferScriptEngineForTest(draft);
  const scriptMeta = getScriptEngineMeta(activeScriptEngine);

  const handleGenerateScript = (engineOverride?: TestScriptEngine) => {
    const targetEngine = engineOverride || activeScriptEngine;
    const generated = generateDefaultScriptForTest(draft, targetEngine);
    setDraft((prev) => ({
      ...prev,
      scriptEngine: targetEngine,
      customScript: generated,
    }));
    setErrors((e) => ({ ...e, customScript: '' }));
  };

  const handleSyncStepsFromScript = () => {
    if (!draft.customScript?.trim()) return;
    const parsed = parseScriptToSteps(draft.customScript, activeScriptEngine);
    if (parsed.length > 0) {
      setDraft((prev) => ({ ...prev, transactionSteps: parsed }));
    }
  };

  const handleRunScriptLive = async () => {
    const scriptText = draft.customScript?.trim()
      ? draft.customScript
      : generateDefaultScriptForTest(draft, activeScriptEngine);
    if (!draft.customScript?.trim()) {
      setDraft((prev) => ({
        ...prev,
        scriptEngine: activeScriptEngine,
        customScript: scriptText,
      }));
    }
    const cleanHeaders: Record<string, string> = {};
    for (const row of headerRows) {
      const k = row.key.trim();
      if (k) cleanHeaders[k] = row.value;
    }
    const rawHost = draft.targetHost?.trim() || 'www.salesforce.com';
    const pathVal = draft.path?.trim() || '/';
    const targetUrl = /^https?:\/\//i.test(pathVal)
      ? pathVal
      : `https://${rawHost}${pathVal.startsWith('/') ? pathVal : `/${pathVal}`}`;

    setRunningScript(true);
    setScriptRunResult(null);
    try {
      const resp = await fetch('/api/v1/scripts/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: scriptText,
          engine: activeScriptEngine,
          targetUrl,
          timeoutMs: draft.scriptTimeoutMs || 15000,
          headers: Object.keys(cleanHeaders).length > 0 ? cleanHeaders : undefined,
          testId: draft.id,
        }),
      });
      const data = (await resp.json()) as ScriptExecutionResult;
      setScriptRunResult(data);
    } catch (err: any) {
      setScriptRunResult({
        engine: activeScriptEngine,
        executionMode: 'emulated-script-runner',
        passed: false,
        durationMs: 0,
        stepLogs: [],
        consoleLogs: [],
        error: err?.message || 'Failed to invoke /api/v1/scripts/execute',
      });
    } finally {
      setRunningScript(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="catchpoint-modal-title"
      data-testid="catchpoint-test-modal"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3 sm:px-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-primary">
                {draft.id || 'NEW'}
              </span>
              <h2
                id="catchpoint-modal-title"
                className="font-display text-sm font-semibold text-foreground sm:text-base"
              >
                {mode === 'create'
                  ? 'Configure Complex Catchpoint Synthetic Check'
                  : `Configure ${draft.id} · ${draft.name}`}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {typeMeta.familyLabel} · {typeMeta.defaultProtocol} · {typeMeta.defaultMonitor}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Catchpoint test builder"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 text-xs">
          {mode === 'create' && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Catchpoint Complex Monitor Presets
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CATCHPOINT_TEST_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyPreset(preset.id)}
                    data-testid={`preset-${preset.id}`}
                    title={preset.summary}
                    className={`rounded border px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
                      draft.testType === preset.testType
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-foreground hover:bg-muted'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Section 1: Monitor Type & Core Identity */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-3">
              <label
                htmlFor="cp-test-id"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Test ID
              </label>
              <input
                id="cp-test-id"
                type="text"
                value={draft.id}
                onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value.toUpperCase() }))}
                data-testid="cp-input-id"
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
              {errors.id && <p className="mt-1 text-[11px] text-rose-600">{errors.id}</p>}
            </div>

            <div className="sm:col-span-5">
              <label
                htmlFor="cp-test-name"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Check Name
              </label>
              <input
                id="cp-test-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Enterprise Signup Multi-Step Transaction"
                data-testid="cp-input-name"
                className="h-8 w-full rounded border border-border bg-background px-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
              />
              {errors.name && <p className="mt-1 text-[11px] text-rose-600">{errors.name}</p>}
            </div>

            <div className="sm:col-span-4">
              <label
                htmlFor="cp-test-type"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Catchpoint Monitor Type
              </label>
              <select
                id="cp-test-type"
                value={draft.testType || 'web-chrome'}
                onChange={(e) => handleChangeTestType(e.target.value as CatchpointTestType)}
                data-testid="cp-select-type"
                className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                {CATCHPOINT_FAMILY_META.map((fam) => (
                  <optgroup key={fam.id} label={fam.label}>
                    {CATCHPOINT_TEST_TYPES.filter((t) => t.family === fam.id).map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded border border-border/80 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{typeMeta.shortLabel}</span>
            {' — '}
            {typeMeta.description}
          </div>

          {/* Section 2: Endpoint, Host Override, Folder, Schedule & SLAs */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <label
                htmlFor="cp-test-path"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Target Path or Full URL
              </label>
              <input
                id="cp-test-path"
                type="text"
                value={draft.path}
                onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
                placeholder="/form/signup/elf-v2-login/"
                data-testid="cp-input-path"
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
              {errors.path && <p className="mt-1 text-[11px] text-rose-600">{errors.path}</p>}
            </div>

            <div className="sm:col-span-4">
              <label
                htmlFor="cp-test-host"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Target Host Override (optional)
              </label>
              <input
                id="cp-test-host"
                type="text"
                value={draft.targetHost || ''}
                onChange={(e) => setDraft((d) => ({ ...d, targetHost: e.target.value }))}
                placeholder="Default property hostMap"
                data-testid="cp-input-target-host"
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="cp-test-folder"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Test Folder
              </label>
              <select
                id="cp-test-folder"
                value={draft.folderId || 'folder-core'}
                onChange={(e) => setDraft((d) => ({ ...d, folderId: e.target.value }))}
                data-testid="cp-select-folder"
                className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none"
              >
                {DEFAULT_TEST_FOLDERS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {sections.has('http') && (
              <div>
                <label
                  htmlFor="cp-http-method"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  HTTP Method
                </label>
                <select
                  id="cp-http-method"
                  value={draft.httpMethod || 'GET'}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      httpMethod: e.target.value as TestCaseDefinition['httpMethod'],
                    }))
                  }
                  data-testid="cp-select-method"
                  className="h-8 w-full rounded border border-border bg-background px-2 font-mono text-xs text-foreground"
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="cp-expected-status"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Expected Status
              </label>
              <input
                id="cp-expected-status"
                type="text"
                value={draft.expectedStatus}
                onChange={(e) => setDraft((d) => ({ ...d, expectedStatus: e.target.value }))}
                data-testid="cp-input-expected-status"
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground"
              />
            </div>

            {(sections.has('port') || draft.port !== undefined) && (
              <div>
                <label
                  htmlFor="cp-port"
                  className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Port
                </label>
                <input
                  id="cp-port"
                  type="number"
                  value={draft.port ?? typeMeta.defaultPort}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      port: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                  data-testid="cp-input-port"
                  className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground tabular-nums"
                />
                {errors.port && <p className="mt-1 text-[11px] text-rose-600">{errors.port}</p>}
              </div>
            )}

            <div>
              <label
                htmlFor="cp-schedule"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Interval (min)
              </label>
              <input
                id="cp-schedule"
                type="number"
                min={1}
                max={1440}
                value={draft.scheduleIntervalMin ?? 5}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    scheduleIntervalMin: Number(e.target.value) || 5,
                  }))
                }
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="cp-sla-warn"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                SLA Warn (ms)
              </label>
              <input
                id="cp-sla-warn"
                type="number"
                min={50}
                value={draft.slaWarningMs ?? 800}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    slaWarningMs: Number(e.target.value) || 800,
                  }))
                }
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground tabular-nums"
              />
            </div>

            <div>
              <label
                htmlFor="cp-sla-crit"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                SLA Crit (ms)
              </label>
              <input
                id="cp-sla-crit"
                type="number"
                min={50}
                value={draft.slaCriticalMs ?? 2000}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    slaCriticalMs: Number(e.target.value) || 2000,
                  }))
                }
                className="h-8 w-full rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground tabular-nums"
              />
              {errors.slaCriticalMs && (
                <p className="mt-1 text-[11px] text-rose-600">{errors.slaCriticalMs}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(draft.critical)}
                onChange={(e) => setDraft((d) => ({ ...d, critical: e.target.checked }))}
                className="accent-primary"
              />
              <span className="font-medium text-foreground">Critical Release-Gate Blocker</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => setDraft((d) => ({ ...d, enabled: e.target.checked }))}
                className="accent-primary"
              />
              <span className="font-medium text-foreground">Monitor Active</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Category:</span>
              <input
                type="text"
                value={draft.category || ''}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                placeholder="Conversion / API / Edge"
                className="h-7 w-36 rounded border border-border bg-background px-2 text-xs text-foreground"
              />
            </div>
          </div>

          {/* Section 3: Protocol-Specific Configurations (DNS / SSL / BGP) */}
          {sections.has('dns') && (
            <div className="rounded-md border border-border bg-background p-3.5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                DNS & DNSSEC Query Settings
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Record Type
                  </label>
                  <select
                    value={draft.dnsRecordType || 'A'}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        dnsRecordType: e.target.value as TestCaseDefinition['dnsRecordType'],
                      }))
                    }
                    data-testid="cp-select-dns-record"
                    className="h-8 w-full rounded border border-border bg-card px-2 font-mono text-xs"
                  >
                    {DNS_RECORD_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {rt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Resolver / Authoritative Server
                  </label>
                  <input
                    type="text"
                    value={draft.dnsServer || '8.8.8.8'}
                    onChange={(e) => setDraft((d) => ({ ...d, dnsServer: e.target.value }))}
                    placeholder="8.8.8.8 or ns1.akam.net"
                    data-testid="cp-input-dns-server"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs"
                  />
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.assertions?.requireDnssec)}
                      onChange={(e) => updateAssertion('requireDnssec', e.target.checked)}
                      className="accent-primary"
                    />
                    <span>Require DNSSEC Validation</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {sections.has('ssl') && (
            <div className="rounded-md border border-border bg-background p-3.5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                SSL / X.509 Certificate Policy
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Minimum Days Until Expiry
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={draft.sslMinExpiryDays ?? 30}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        sslMinExpiryDays: Number(e.target.value) || 30,
                      }))
                    }
                    data-testid="cp-input-ssl-expiry"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Minimum TLS Protocol
                  </label>
                  <select
                    value={draft.assertions?.minTlsVersion || 'TLSv1.2'}
                    onChange={(e) => updateAssertion('minTlsVersion', e.target.value)}
                    data-testid="cp-select-min-tls"
                    className="h-8 w-full rounded border border-border bg-card px-2 font-mono text-xs"
                  >
                    <option value="TLSv1.2">TLSv1.2</option>
                    <option value="TLSv1.3">TLSv1.3</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {sections.has('bgp') && (
            <div className="rounded-md border border-border bg-background p-3.5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                BGP Prefix & Anycast ASN
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Expected IP Prefix
                  </label>
                  <input
                    type="text"
                    value={draft.bgpPrefix || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, bgpPrefix: e.target.value }))}
                    placeholder="23.200.0.0/16"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs"
                  />
                  {errors.bgpPrefix && (
                    <p className="mt-1 text-[11px] text-rose-600">{errors.bgpPrefix}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-muted-foreground">
                    Expected Origin ASN
                  </label>
                  <input
                    type="text"
                    value={draft.bgpOriginAsn || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, bgpOriginAsn: e.target.value }))}
                    placeholder="AS20940"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Section 4: Multi-Step Transaction Script Builder */}
          {sections.has('transaction') && (
            <div
              className="rounded-md border border-border bg-background p-3.5 space-y-3"
              data-testid="cp-transaction-builder"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Multi-Step Transaction Script ({steps.length} steps)
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Sequential Catchpoint/Playwright actions verified per run
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleAddStep}
                  data-testid="cp-btn-add-step"
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2.5 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                >
                  <Plus className="h-3 w-3 text-primary" />
                  <span>Add Step</span>
                </button>
              </div>

              <div className="space-y-2">
                {steps.map((step, idx) => (
                  <div
                    key={idx}
                    data-testid={`cp-tx-step-${idx}`}
                    className="grid grid-cols-1 gap-2 rounded border border-border/80 bg-card p-2 sm:grid-cols-[36px_158px_1fr_1fr_auto] items-center"
                  >
                    <span className="font-mono text-[11px] font-semibold text-primary text-center">
                      #{idx + 1}
                    </span>
                    <select
                      value={step.action}
                      onChange={(e) =>
                        handleUpdateStep(idx, {
                          action: e.target.value as TransactionStep['action'],
                        })
                      }
                      aria-label={`Step ${idx + 1} action`}
                      className="h-7 rounded border border-border bg-background px-1.5 font-mono text-[11px]"
                    >
                      {STEP_ACTIONS.map((act) => (
                        <option key={act} value={act}>
                          {act}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={step.target}
                      onChange={(e) => handleUpdateStep(idx, { target: e.target.value })}
                      placeholder="CSS selector or path (e.g. form#login, /pricing)"
                      aria-label={`Step ${idx + 1} target`}
                      className="h-7 rounded border border-border bg-background px-2 font-mono text-[11px]"
                    />
                    <input
                      type="text"
                      value={
                        step.action === 'assertText'
                          ? step.assertText || ''
                          : step.value || ''
                      }
                      onChange={(e) =>
                        step.action === 'assertText'
                          ? handleUpdateStep(idx, { assertText: e.target.value })
                          : handleUpdateStep(idx, { value: e.target.value })
                      }
                      placeholder={
                        step.action === 'assertText'
                          ? 'Expected text substring'
                          : step.action === 'assertStatus'
                          ? 'Expected status (200)'
                          : 'Input value (optional)'
                      }
                      aria-label={`Step ${idx + 1} value`}
                      className="h-7 rounded border border-border bg-background px-2 font-mono text-[11px]"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveStep(idx, -1)}
                        aria-label={`Move step ${idx + 1} up`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === steps.length - 1}
                        onClick={() => handleMoveStep(idx, 1)}
                        aria-label={`Move step ${idx + 1} down`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveStep(idx)}
                        aria-label={`Remove step ${idx + 1}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {steps.length === 0 && (
                  <div className="py-3 text-center text-[11px] text-muted-foreground">
                    No transaction steps yet — click Add Step to define an interactive script.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 4B: Programmable Test Script (Playwright / Puppeteer / Catchpoint / Selenium / k6 / Fetch) */}
          {(sections.has('script') || Boolean(draft.customScript?.trim())) && (
            <div
              className="rounded-md border border-border bg-background p-3.5 space-y-3"
              data-testid="cp-script-editor-section"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    <Code2 className="h-3.5 w-3.5 text-primary" />
                    <span>Test Script & Library Runner ({scriptMeta.label})</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {scriptMeta.description}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={activeScriptEngine}
                    onChange={(e) => {
                      const nextEng = e.target.value as TestScriptEngine;
                      setDraft((d) => ({ ...d, scriptEngine: nextEng }));
                    }}
                    aria-label="Test script library"
                    data-testid="cp-select-script-engine"
                    className="h-7 rounded border border-border bg-card px-2 font-mono text-[11px] text-foreground"
                  >
                    {SCRIPT_ENGINE_LIST.map((eng) => (
                      <option key={eng.id} value={eng.id}>
                        {eng.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleGenerateScript()}
                    data-testid="cp-btn-generate-script"
                    className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3 text-primary" />
                    <span>Generate Template</span>
                  </button>
                  {sections.has('transaction') && (
                    <button
                      type="button"
                      onClick={handleSyncStepsFromScript}
                      data-testid="cp-btn-parse-script"
                      className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium text-foreground hover:bg-muted cursor-pointer"
                    >
                      <span>Sync Steps</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={runningScript}
                    onClick={handleRunScriptLive}
                    data-testid="cp-btn-test-script"
                    className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    <span>{runningScript ? 'Running...' : 'Run Script Live'}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px] items-end">
                <div className="text-[11px] font-mono text-muted-foreground">
                  Globals injected: <span className="text-foreground">page, expect, targetUrl, baseUrl, driver, By, http, check, fetch</span>
                </div>
                <div>
                  <label
                    htmlFor="cp-script-timeout"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Script Timeout (ms)
                  </label>
                  <input
                    id="cp-script-timeout"
                    type="number"
                    min={3000}
                    max={20000}
                    value={draft.scriptTimeoutMs ?? 15000}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        scriptTimeoutMs: Number(e.target.value) || 15000,
                      }))
                    }
                    data-testid="cp-input-script-timeout"
                    className="h-7 w-full rounded border border-border bg-card px-2 font-mono text-[11px] tabular-nums"
                  />
                </div>
              </div>

              <textarea
                rows={8}
                spellCheck={false}
                value={draft.customScript || ''}
                onChange={(e) => {
                  setDraft((d) => ({
                    ...d,
                    scriptEngine: d.scriptEngine || activeScriptEngine,
                    customScript: e.target.value,
                  }));
                  if (errors.customScript) {
                    setErrors((prev) => ({ ...prev, customScript: '' }));
                  }
                }}
                placeholder={`// Paste or generate ${scriptMeta.label} script, e.g.:\nexport default async function runTest({ page, expect, targetUrl }) {\n  const res = await page.goto(targetUrl);\n  expect(res.status()).toBe(200);\n  await page.waitForSelector('h1, main');\n  await expect(page.locator('body')).toContainText('Salesforce');\n}`}
                aria-label="Synthetic test script editor"
                data-testid="cp-textarea-script"
                className="w-full rounded border border-border bg-card p-2.5 font-mono text-[11px] leading-relaxed text-foreground focus:border-primary focus:outline-none"
              />
              {errors.customScript && (
                <p className="text-[11px] text-rose-600">{errors.customScript}</p>
              )}

              {scriptRunResult && (
                <div
                  data-testid="cp-script-run-output"
                  className={`rounded border p-2.5 space-y-1.5 text-[11px] ${
                    scriptRunResult.passed
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-rose-500/40 bg-rose-500/5'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                    <span
                      className={`font-semibold ${
                        scriptRunResult.passed
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {scriptRunResult.passed ? 'SCRIPT PASSED' : 'SCRIPT FAILED'} ·{' '}
                      {scriptRunResult.engine} ({scriptRunResult.durationMs}ms)
                    </span>
                    <span className="text-muted-foreground">
                      {scriptRunResult.executionMode === 'real-chromium-playwright'
                        ? 'Real Headless Chromium'
                        : 'Emulated Runner'}
                      {scriptRunResult.pageTitle ? ` · "${scriptRunResult.pageTitle}"` : ''}
                    </span>
                  </div>
                  {scriptRunResult.error && (
                    <div className="font-mono text-rose-600 dark:text-rose-400">
                      Error: {scriptRunResult.error}
                    </div>
                  )}
                  {scriptRunResult.stepLogs.length > 0 && (
                    <div className="space-y-0.5 font-mono text-[10px]">
                      {scriptRunResult.stepLogs.map((st) => (
                        <div key={st.step} className="flex items-center justify-between gap-2">
                          <span className="truncate text-foreground">
                            #{st.step} {st.action} {st.target} — {st.detail}
                          </span>
                          <span
                            className={`shrink-0 tabular-nums ${
                              st.status === 'pass'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {st.durationMs}ms {st.status.toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {scriptRunResult.consoleLogs.length > 0 && (
                    <div className="border-t border-border/60 pt-1 font-mono text-[10px] text-muted-foreground">
                      {scriptRunResult.consoleLogs.slice(0, 5).map((log, i) => (
                        <div key={i} className="truncate">
                          &gt; {log}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Section 5: Request Headers & Raw Payload Body */}
          {sections.has('headers') && (
            <div className="rounded-md border border-border bg-background p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Custom Request Headers ({headerRows.length})
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Authorization, Cookie, and x-api-key headers are automatically masked in reports & cURL
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setHeaderRows((rows) => [...rows, { key: '', value: '' }])
                  }
                  data-testid="cp-btn-add-header"
                  className="inline-flex h-7 items-center gap-1 rounded border border-border bg-card px-2.5 text-[11px] font-medium hover:bg-muted cursor-pointer"
                >
                  <Plus className="h-3 w-3 text-primary" />
                  <span>Add Header</span>
                </button>
              </div>

              {headerRows.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto] items-center"
                >
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) =>
                      setHeaderRows((rows) =>
                        rows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r))
                      )
                    }
                    placeholder="Header name (e.g. x-api-client)"
                    aria-label={`Header ${idx + 1} name`}
                    className="h-7.5 rounded border border-border bg-card px-2 font-mono text-xs"
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) =>
                      setHeaderRows((rows) =>
                        rows.map((r, i) =>
                          i === idx ? { ...r, value: e.target.value } : r
                        )
                      )
                    }
                    placeholder="Header value"
                    aria-label={`Header ${idx + 1} value`}
                    className="h-7.5 rounded border border-border bg-card px-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setHeaderRows((rows) => rows.filter((_, i) => i !== idx))
                    }
                    aria-label={`Remove header ${idx + 1}`}
                    className="inline-flex h-7.5 w-7.5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {sections.has('body') && (
            <div className="rounded-md border border-border bg-background p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="cp-request-body"
                  className="text-[11px] font-semibold uppercase tracking-wider text-foreground"
                >
                  Request Payload Body (JSON / GraphQL / XML)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(
                        JSON.parse(draft.requestBody || '{}'),
                        null,
                        2
                      );
                      setDraft((d) => ({ ...d, requestBody: formatted }));
                    } catch {
                      // Leave raw GraphQL/XML intact
                    }
                  }}
                  className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                >
                  Format JSON
                </button>
              </div>
              <textarea
                id="cp-request-body"
                rows={4}
                value={draft.requestBody || ''}
                onChange={(e) => setDraft((d) => ({ ...d, requestBody: e.target.value }))}
                placeholder='{"query":"query Health { ok }"}'
                data-testid="cp-textarea-body"
                className="w-full rounded border border-border bg-card p-2.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
              />
            </div>
          )}

          {/* Section 6: Response Assertions & Thresholds */}
          {sections.has('assertions') && (
            <div className="rounded-md border border-border bg-background p-3.5 space-y-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                Release-Gate Response Assertions
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor="cp-assert-body"
                    className="mb-1 block text-[11px] text-muted-foreground"
                  >
                    Expected Body Match (Regex / Text)
                  </label>
                  <input
                    id="cp-assert-body"
                    type="text"
                    value={draft.assertions?.expectedBodyMatch || ''}
                    onChange={(e) =>
                      updateAssertion('expectedBodyMatch', e.target.value)
                    }
                    placeholder="e.g. Salesforce|CRM"
                    data-testid="cp-input-assert-body"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cp-assert-latency"
                    className="mb-1 block text-[11px] text-muted-foreground"
                  >
                    Max Latency Budget (ms)
                  </label>
                  <input
                    id="cp-assert-latency"
                    type="number"
                    min={10}
                    value={draft.assertions?.maxLatencyMs ?? ''}
                    onChange={(e) =>
                      updateAssertion(
                        'maxLatencyMs',
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                    placeholder="e.g. 2500"
                    data-testid="cp-input-assert-latency"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label
                    htmlFor="cp-assert-hops"
                    className="mb-1 block text-[11px] text-muted-foreground"
                  >
                    Max Redirect / Network Hops
                  </label>
                  <input
                    id="cp-assert-hops"
                    type="number"
                    min={1}
                    value={draft.assertions?.maxHops ?? ''}
                    onChange={(e) =>
                      updateAssertion(
                        'maxHops',
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                    placeholder="e.g. 5"
                    data-testid="cp-input-assert-hops"
                    className="h-8 w-full rounded border border-border bg-card px-2.5 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 items-center rounded border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="cp-btn-save"
              className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{mode === 'create' ? 'Add Complex Check' : 'Save Check Configuration'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
