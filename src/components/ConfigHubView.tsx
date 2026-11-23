import React, { useEffect, useState } from 'react';
import { Globe, ShieldCheck, Sliders } from 'lucide-react';
import { AcceptedRule, AppConfig } from '../engine/types';
import { TestCaseDefinition } from '../config/template.config';
import { SetupView } from './SetupView';
import { PoliciesView } from './PoliciesView';

export type ConfigHubSection = 'suite' | 'policies';
type FlatConfigTab = 'checks' | 'envs' | 'policies';

export interface ConfigHubViewProps {
  initialSection?: ConfigHubSection;
  initialSetupTab?: 'suite' | 'envs';
  apps: AppConfig[];
  activeAppId: string;
  suitesByAppId: Record<string, TestCaseDefinition[]>;
  onSelectApp: (appId: string) => void;
  onCreateProperty: (app: AppConfig) => void;
  onSaveProperty: (app: AppConfig) => void;
  onDeleteProperty: (appId: string) => void;
  onSaveSuite: (appId: string, suite: TestCaseDefinition[]) => void;
  onOpenSynthetics: () => void;
  // Policies props
  acceptedRules: AcceptedRule[];
  acceptedCookies: string[];
  acceptedVisualTests: string[];
  acceptedVisualParams?: Record<string, string[]>;
  ignoreAcceptedDiffs: boolean;
  onToggleIgnoreAccepted: () => void;
  onToggleRuleEnabled: (id: string) => void;
  onDeleteRule: (id: string) => void;
  onAddHeaderRule: (field: string, note?: string) => void;
  onAddCookiePolicy: (name: string) => void;
  onRemoveCookiePolicy: (name: string) => void;
  onRemoveVisualPolicy: (testId: string) => void;
  onRemoveVisualParamPolicy?: (testId: string, paramId: string) => void;
  onResetPolicies: () => void;
}

export const ConfigHubView: React.FC<ConfigHubViewProps> = ({
  initialSection = 'suite',
  initialSetupTab = 'suite',
  apps,
  activeAppId,
  suitesByAppId,
  onSelectApp,
  onCreateProperty,
  onSaveProperty,
  onDeleteProperty,
  onSaveSuite,
  onOpenSynthetics,
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
  const resolveInitialTab = (): FlatConfigTab => {
    if (initialSection === 'policies') return 'policies';
    return initialSetupTab === 'envs' ? 'envs' : 'checks';
  };

  const [activeTab, setActiveTab] = useState<FlatConfigTab>(resolveInitialTab);

  useEffect(() => {
    if (initialSection === 'policies') {
      setActiveTab('policies');
    } else if (initialSetupTab === 'envs') {
      setActiveTab('envs');
    } else {
      setActiveTab('checks');
    }
  }, [initialSection, initialSetupTab]);

  const activeProp = apps.find((a) => a.id === activeAppId) || apps[0];
  const activeChecksCount = (suitesByAppId[activeAppId] || []).length;
  const activeEnvsCount = activeProp?.envs.length || 0;

  const enabledRulesCount = acceptedRules.filter((r) => r.enabled).length;
  const acceptedVisualParamCount = Object.values(acceptedVisualParams).reduce(
    (sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0),
    0
  );
  const totalVisualWaivers = acceptedVisualTests.length + acceptedVisualParamCount;
  const totalPolicies = enabledRulesCount + acceptedCookies.length + totalVisualWaivers;

  return (
    <div
      data-testid="config-hub-view"
      className="flex flex-col flex-1 min-w-0 lg:h-[calc(100vh-3rem)] lg:overflow-hidden"
    >
      {/* Single-Level Flattened Config Bar (Checks · Environments · Accepted Rules) */}
      <div className="shrink-0 border-b border-border bg-card px-3 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Configuration sections"
            className="flex items-center gap-5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'checks'}
              data-testid="config-tab-suite"
              onClick={() => setActiveTab('checks')}
              className={`relative inline-flex h-9 items-center gap-1.5 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'checks'
                  ? 'font-semibold text-foreground'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sliders className="h-3.5 w-3.5 text-primary" />
              <span>Checks</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {activeChecksCount}
              </span>
              {activeTab === 'checks' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                />
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'envs'}
              data-testid="setup-tab-envs"
              onClick={() => setActiveTab('envs')}
              className={`relative inline-flex h-9 items-center gap-1.5 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'envs'
                  ? 'font-semibold text-foreground'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe className="h-3.5 w-3.5 text-primary" />
              <span>Environments</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {activeEnvsCount}
              </span>
              {activeTab === 'envs' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                />
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'policies'}
              data-testid="config-tab-policies"
              onClick={() => setActiveTab('policies')}
              className={`relative inline-flex h-9 items-center gap-1.5 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === 'policies'
                  ? 'font-semibold text-foreground'
                  : 'font-medium text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span>Accepted Rules</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {totalPolicies}
              </span>
              {activeTab === 'policies' && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                />
              )}
            </button>
          </div>

          <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {apps.length} {apps.length === 1 ? 'site' : 'sites'} · Editing{' '}
              <span className="font-mono font-medium text-foreground">{activeAppId}</span>
            </span>
          </div>
        </div>
      </div>

      {activeTab === 'policies' ? (
        <PoliciesView
          acceptedRules={acceptedRules}
          acceptedCookies={acceptedCookies}
          acceptedVisualTests={acceptedVisualTests}
          acceptedVisualParams={acceptedVisualParams}
          ignoreAcceptedDiffs={ignoreAcceptedDiffs}
          onToggleIgnoreAccepted={onToggleIgnoreAccepted}
          onToggleRuleEnabled={onToggleRuleEnabled}
          onDeleteRule={onDeleteRule}
          onAddHeaderRule={onAddHeaderRule}
          onAddCookiePolicy={onAddCookiePolicy}
          onRemoveCookiePolicy={onRemoveCookiePolicy}
          onRemoveVisualPolicy={onRemoveVisualPolicy}
          onRemoveVisualParamPolicy={onRemoveVisualParamPolicy}
          onResetPolicies={onResetPolicies}
        />
      ) : (
        <SetupView
          apps={apps}
          activeAppId={activeAppId}
          suitesByAppId={suitesByAppId}
          initialTab={activeTab === 'envs' ? 'envs' : 'suite'}
          controlledTab={activeTab === 'envs' ? 'envs' : 'suite'}
          hideInnerTabs
          onSelectApp={onSelectApp}
          onCreateProperty={onCreateProperty}
          onSaveProperty={onSaveProperty}
          onDeleteProperty={onDeleteProperty}
          onSaveSuite={onSaveSuite}
          onOpenSynthetics={onOpenSynthetics}
        />
      )}
    </div>
  );
};
