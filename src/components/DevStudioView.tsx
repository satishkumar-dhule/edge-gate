import React, { useEffect, useState } from 'react';
import { Code2, EyeOff, Radio } from 'lucide-react';
import { AppConfig, ComparisonItem } from '../engine/types';
import { TemplateConfig, TestCaseDefinition } from '../config/template.config';
import { InspectorDimensionTab, PropertyGateSummary } from '../engine/workbenchModel';
import { McpStudioView } from './McpStudioView';
import { VsCodeView } from './VsCodeView';

export type DevStudioMode = 'mcp' | 'vscode';

export interface DevStudioViewProps {
  initialMode?: DevStudioMode;
  codeEditorUnlocked: boolean;
  onModeChange?: (mode: DevStudioMode) => void;
  onLockCodeEditor?: () => void;
  theme: 'light' | 'dark';
  activeAppId: string;
  activeApp?: AppConfig;
  activeSuite: TestCaseDefinition[];
  liveTemplateConfig: TemplateConfig;
  selectedItem?: ComparisonItem;
  propertySummaries: PropertyGateSummary[];
  onOpenWorkbench: () => void;
  onInspectPropertyInWorkbench: (
    appId: string,
    testId?: string,
    tab?: InspectorDimensionTab
  ) => void;
  onSaveProperty: (app: AppConfig) => void;
  onSaveSuite: (appId: string, suite: TestCaseDefinition[]) => void;
  onConfigMutated?: () => void;
}

export const DevStudioView: React.FC<DevStudioViewProps> = ({
  initialMode = 'mcp',
  codeEditorUnlocked,
  onModeChange,
  onLockCodeEditor,
  theme,
  activeAppId,
  activeApp,
  activeSuite,
  liveTemplateConfig,
  selectedItem,
  propertySummaries,
  onOpenWorkbench,
  onInspectPropertyInWorkbench,
  onSaveProperty,
  onSaveSuite,
  onConfigMutated,
}) => {
  const [mode, setMode] = useState<DevStudioMode>(
    codeEditorUnlocked ? initialMode : 'mcp'
  );

  useEffect(() => {
    setMode(codeEditorUnlocked ? initialMode : 'mcp');
  }, [initialMode, codeEditorUnlocked]);

  const effectiveMode: DevStudioMode = codeEditorUnlocked ? mode : 'mcp';

  const selectMode = (next: DevStudioMode) => {
    if (next === 'vscode' && !codeEditorUnlocked) return;
    setMode(next);
    onModeChange?.(next);
  };

  return (
    <div data-testid="dev-studio-view" className="flex flex-col flex-1 min-w-0">
      {/* Mode switcher is rendered only after unlocking the hidden Code Editor */}
      {codeEditorUnlocked && (
        <div className="shrink-0 border-b border-border bg-card px-3 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Developer Studio tools"
              className="flex items-center gap-5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={effectiveMode === 'mcp'}
                data-testid="studio-tab-mcp"
                onClick={() => selectMode('mcp')}
                className={`relative inline-flex h-9 items-center gap-1.5 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  effectiveMode === 'mcp'
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:text-foreground'
                }`}
              >
                <Radio className="h-3.5 w-3.5 text-primary" />
                <span>MCP Console</span>
                {effectiveMode === 'mcp' && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  />
                )}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={effectiveMode === 'vscode'}
                data-testid="studio-tab-vscode"
                onClick={() => selectMode('vscode')}
                className={`relative inline-flex h-9 items-center gap-1.5 text-xs whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  effectiveMode === 'vscode'
                    ? 'font-semibold text-foreground'
                    : 'font-medium text-muted-foreground hover:text-foreground'
                }`}
              >
                <Code2 className="h-3.5 w-3.5 text-primary" />
                <span>Code Editor</span>
                {effectiveMode === 'vscode' && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-primary"
                  />
                )}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden md:inline text-[11px] font-mono text-muted-foreground">
                Site: {activeAppId}
              </span>
              {onLockCodeEditor && (
                <button
                  type="button"
                  data-testid="studio-lock-vscode"
                  onClick={onLockCodeEditor}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <EyeOff className="h-3 w-3" />
                  <span>Hide Editor</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {effectiveMode === 'mcp' ? (
        <McpStudioView
          activeAppId={activeAppId}
          propertySummaries={propertySummaries}
          onOpenWorkbench={onOpenWorkbench}
          onInspectPropertyInWorkbench={onInspectPropertyInWorkbench}
          onConfigMutated={onConfigMutated}
        />
      ) : (
        <div className="flex-1 min-w-0">
          <VsCodeView
            theme={theme}
            activeApp={activeApp}
            activeSuite={activeSuite}
            liveTemplateConfig={liveTemplateConfig}
            selectedItem={selectedItem}
            onSaveProperty={onSaveProperty}
            onSaveSuite={onSaveSuite}
          />
        </div>
      )}
    </div>
  );
};
