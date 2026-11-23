import React, { useMemo, useState } from 'react';
import { Download, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { AcceptedRule } from '../engine/types';

export interface PoliciesViewProps {
  acceptedRules: AcceptedRule[];
  acceptedCookies: string[];
  acceptedVisualTests: string[];
  acceptedVisualParams?: Record<string, string[]>;
  ignoreAcceptedDiffs: boolean;
  onToggleIgnoreAccepted: () => void;
  onToggleRuleEnabled: (ruleId: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onAddHeaderRule?: (field: string, note?: string) => void;
  onAddCookiePolicy: (cookieName: string) => void;
  onRemoveCookiePolicy: (cookieName: string) => void;
  onRemoveVisualPolicy: (testId: string) => void;
  onRemoveVisualParamPolicy?: (testId: string, paramId: string) => void;
  onResetPolicies: () => void;
}

export const PoliciesView: React.FC<PoliciesViewProps> = ({
  acceptedRules,
  acceptedCookies,
  acceptedVisualTests,
  acceptedVisualParams = {},
  ignoreAcceptedDiffs,
  onToggleIgnoreAccepted,
  onToggleRuleEnabled,
  onDeleteRule,
  onAddHeaderRule,
  onAddCookiePolicy,
  onRemoveCookiePolicy,
  onRemoveVisualPolicy,
  onRemoveVisualParamPolicy,
  onResetPolicies,
}) => {
  const [newCookie, setNewCookie] = useState('');
  const [newHeaderField, setNewHeaderField] = useState('');
  const [newHeaderNote, setNewHeaderNote] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'paused'>('all');

  const handleAddCookie = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newCookie.trim();
    if (!cleaned) return;
    onAddCookiePolicy(cleaned);
    setNewCookie('');
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    const field = newHeaderField.trim();
    if (!field || !onAddHeaderRule) return;
    onAddHeaderRule(field, newHeaderNote.trim() || undefined);
    setNewHeaderField('');
    setNewHeaderNote('');
  };

  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return acceptedRules.filter((rule) => {
      if (statusFilter === 'enabled' && !rule.enabled) return false;
      if (statusFilter === 'paused' && rule.enabled) return false;
      if (q) {
        const hay = `${rule.kind} ${rule.comparisonId} ${rule.testId || ''} ${rule.note || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [acceptedRules, searchQuery, statusFilter]);

  const filteredCookies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return acceptedCookies;
    return acceptedCookies.filter((c) => c.toLowerCase().includes(q));
  }, [acceptedCookies, searchQuery]);

  const filteredVisual = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return acceptedVisualTests;
    return acceptedVisualTests.filter((id) => id.toLowerCase().includes(q));
  }, [acceptedVisualTests, searchQuery]);

  const filteredVisualParams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const entries: Array<{ testId: string; paramId: string }> = [];
    for (const [testId, paramIds] of Object.entries(acceptedVisualParams)) {
      for (const paramId of paramIds || []) {
        if (
          !q ||
          testId.toLowerCase().includes(q) ||
          paramId.toLowerCase().includes(q)
        ) {
          entries.push({ testId, paramId });
        }
      }
    }
    return entries;
  }, [acceptedVisualParams, searchQuery]);

  const handleExportPolicies = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      ignoreAcceptedDiffs,
      acceptedRules,
      acceptedCookies,
      acceptedVisualTests,
      acceptedVisualParams,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `release-gate-policies-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 space-y-2.5">
      {/* Unified Single-Row Policy Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <div className="relative w-52 sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search rules, cookies, or visual…"
              aria-label="Search policies"
              className="h-7.5 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear policy search"
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex h-7.5 items-center rounded-md border border-border bg-background p-0.5 text-[11px]">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'enabled', label: 'Enabled' },
                { id: 'paused', label: 'Paused' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`h-6.5 rounded px-2 font-medium cursor-pointer transition-colors ${
                  statusFilter === opt.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={ignoreAcceptedDiffs}
            onClick={onToggleIgnoreAccepted}
            className="inline-flex h-7.5 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
          >
            <span
              className={`inline-block h-3 w-5 rounded-full relative transition-colors ${
                ignoreAcceptedDiffs ? 'bg-primary' : 'bg-muted-foreground/40'
              }`}
            >
              <span
                className={`absolute top-0.5 h-2 w-2 rounded-full bg-white transition-transform ${
                  ignoreAcceptedDiffs ? 'left-2.5' : 'left-0.5'
                }`}
              />
            </span>
            <span>Hide Accepted Diffs</span>
          </button>

          <button
            type="button"
            onClick={handleExportPolicies}
            className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Export</span>
          </button>

          <button
            type="button"
            onClick={onResetPolicies}
            className="inline-flex h-7.5 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Header Rules */}
        <section className="lg:col-span-5 rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
            <h2 className="text-xs font-semibold text-foreground">
              Accepted Header Rules ({filteredRules.length})
            </h2>
          </div>

          {onAddHeaderRule && (
            <form
              onSubmit={handleAddRule}
              className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/20 p-2.5"
            >
              <input
                type="text"
                value={newHeaderField}
                onChange={(e) => setNewHeaderField(e.target.value)}
                placeholder="Header field (e.g. x-akamai-request-id)"
                aria-label="Header rule field"
                className="h-8 min-w-[170px] flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <input
                type="text"
                value={newHeaderNote}
                onChange={(e) => setNewHeaderNote(e.target.value)}
                placeholder="Reason / note (optional)"
                aria-label="Header rule note"
                className="h-8 min-w-[140px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Rule</span>
              </button>
            </form>
          )}

          <div className="divide-y divide-border/70">
            {filteredRules.map((rule) => (
              <div
                key={rule.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-foreground">
                      {rule.kind}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      scope: {rule.comparisonId}
                      {rule.testId ? ` · ${rule.testId}` : ''}
                    </span>
                  </div>
                  {rule.note && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {rule.note}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleRuleEnabled(rule.id)}
                    className={`inline-flex h-7 items-center rounded border px-2 text-[11px] font-medium cursor-pointer ${
                      rule.enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-border bg-muted text-muted-foreground'
                    }`}
                  >
                    {rule.enabled ? 'Enabled' : 'Paused'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteRule(rule.id)}
                    aria-label={`Delete rule ${rule.kind}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:text-rose-600 hover:bg-muted cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {filteredRules.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No matching header drift rules.
              </div>
            )}
          </div>
        </section>

        {/* Cookies */}
        <section className="lg:col-span-3 rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-2">
            <h2 className="text-xs font-semibold text-foreground">
              Allowlisted Cookies ({filteredCookies.length})
            </h2>
          </div>

          <form
            onSubmit={handleAddCookie}
            className="flex items-center gap-2 border-b border-border bg-muted/20 p-2.5"
          >
            <input
              type="text"
              value={newCookie}
              onChange={(e) => setNewCookie(e.target.value)}
              placeholder="Cookie name (e.g. edge_region)"
              aria-label="Cookie name"
              data-testid="add-cookie-policy-input"
              className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 cursor-pointer shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          </form>

          <div className="divide-y divide-border/70">
            {filteredCookies.map((cookie) => (
              <div
                key={cookie}
                className="flex items-center justify-between px-3.5 py-2 text-xs"
              >
                <span className="font-mono text-foreground">{cookie}</span>
                <button
                  type="button"
                  onClick={() => onRemoveCookiePolicy(cookie)}
                  aria-label={`Remove cookie ${cookie}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {filteredCookies.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No matching cookie allowlist entries.
              </div>
            )}
          </div>
        </section>

        {/* Visual Baselines & AI Parameter Waivers */}
        <section className="lg:col-span-4 rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-3.5 py-2">
            <h2 className="text-xs font-semibold text-foreground">
              Accepted Visual Baselines ({filteredVisual.length + filteredVisualParams.length})
            </h2>
          </div>

          <div className="divide-y divide-border/70">
            {filteredVisual.map((testId) => (
              <div
                key={`full-${testId}`}
                className="flex items-center justify-between px-3.5 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-foreground">
                    {testId}
                  </span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    All visual parameters
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveVisualPolicy(testId)}
                  aria-label={`Remove visual baseline ${testId}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-rose-600 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {filteredVisualParams.map(({ testId, paramId }) => (
              <div
                key={`param-${testId}-${paramId}`}
                className="flex items-center justify-between gap-2 px-3.5 py-2 text-xs"
              >
                <div className="min-w-0 truncate">
                  <span className="font-mono font-semibold text-foreground">
                    {testId}
                  </span>
                  <span className="mx-1.5 text-muted-foreground">·</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {paramId}
                  </span>
                </div>
                {onRemoveVisualParamPolicy && (
                  <button
                    type="button"
                    onClick={() => onRemoveVisualParamPolicy(testId, paramId)}
                    aria-label={`Remove accepted visual parameter ${paramId} on ${testId}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {filteredVisual.length === 0 && filteredVisualParams.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground leading-relaxed">
                No visual baselines or AI parameters accepted yet. Accept individual visual parameters from Compare → Visual AI.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
