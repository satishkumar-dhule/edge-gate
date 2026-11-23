import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Loader2,
  Play,
  Send,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  AgentPortalAction,
  AgentPortalContext,
  AgentSkillDefinition,
  PORTAL_AGENT_SKILLS,
} from '../engine/agentSkills';

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  matchedSkills?: string[];
  actions?: AgentPortalAction[];
  mode?: 'gemini' | 'planner';
  model?: string;
}

export interface AgentChatDrawerProps {
  open: boolean;
  onClose: () => void;
  context: AgentPortalContext;
  messages: AgentChatMessage[];
  isBusy: boolean;
  enabledSkillIds: string[];
  onToggleSkill: (skillId: string) => void;
  onSendMessage: (prompt: string) => Promise<void> | void;
  onClearChat: () => void;
}

function renderFormattedLine(line: string, keyPrefix: string) {
  // Lightweight safe inline formatting for **bold** and `code`
  const tokens = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return tokens.map((tok, i) => {
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-semibold text-foreground">
          {tok.slice(2, -2)}
        </strong>
      );
    }
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      return (
        <code
          key={`${keyPrefix}-${i}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground"
        >
          {tok.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{tok}</React.Fragment>;
  });
}

function formatActionLabel(act: AgentPortalAction): string {
  switch (act.type) {
    case 'switch_view':
      return `view → ${act.viewMode}`;
    case 'select_property':
      return `property → ${act.appId}`;
    case 'select_check':
      return `${act.testId}${act.tab ? ` (${act.tab})` : ''}`;
    case 'set_comparison_targets':
      return `targets updated`;
    case 'run_live_gate':
      return `Run Live Gate${act.appId ? ` (${act.appId})` : ''}`;
    case 'rerun_check':
      return `Re-run ${act.testId}`;
    case 'run_ai_visual_judge':
      return `AI Visual Judge (${act.testId})`;
    case 'trigger_scheduled_run':
      return `Scheduled Run (${act.appId || 'active'})`;
    case 'update_schedule_policy':
      return `Schedule policy${act.intervalMinutes ? ` ${act.intervalMinutes}m` : ''}`;
    case 'inspect_schedule_graph':
      return `Graph → ${act.graphMode || 'timeseries'}${act.timeRange ? ` · ${act.timeRange}` : ''}`;
    case 'create_property':
      return `Create property ${act.id}`;
    case 'upsert_environment':
      return `Env ${act.envId}`;
    case 'create_or_update_test':
      return `${act.testId || 'New'} ${act.testType || 'check'}`;
    case 'delete_test':
      return `Delete ${act.testId}`;
    case 'toggle_accept_header':
      return `Header rule: ${act.field}`;
    case 'toggle_accept_cookie':
      return `Cookie rule: ${act.cookieName}`;
    case 'toggle_accept_visual':
      return `Visual rule: ${act.testId}`;
    case 'reset_policies':
      return `Reset policies`;
    case 'copy_gate_report':
      return `Copy Markdown report`;
  }
}

export const AgentChatDrawer: React.FC<AgentChatDrawerProps> = ({
  open,
  onClose,
  context,
  messages,
  isBusy,
  enabledSkillIds,
  onToggleSkill,
  onSendMessage,
  onClearChat,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'skills'>('chat');
  const [input, setInput] = useState('');
  const [skillQuery, setSkillQuery] = useState('');
  const [skillsCatalog, setSkillsCatalog] =
    useState<AgentSkillDefinition[]>(PORTAL_AGENT_SKILLS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/v1/agent/skills')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.skills) && data.skills.length > 0) {
          setSkillsCatalog(data.skills as AgentSkillDefinition[]);
        }
      })
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (open && activeTab === 'chat') {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open, activeTab]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isBusy]);

  const filteredSkills = useMemo(() => {
    const q = skillQuery.trim().toLowerCase();
    if (!q) return skillsCatalog;
    return skillsCatalog.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [skillsCatalog, skillQuery]);

  if (!open) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isBusy) return;
    setInput('');
    await onSendMessage(trimmed);
  };

  const handleRunSkillPrompt = async (starterPrompt: string) => {
    setActiveTab('chat');
    await onSendMessage(starterPrompt);
  };

  const quickPrompts = [
    `Run Live Gate on ${context.activeAppId}`,
    `Why is ${context.activeAppId} ${context.headlineVerdict} and what drifted?`,
    `Add Playwright test /checkout/health on ${context.activeAppId}`,
    `Summarize active NO-GO blockers`,
  ];

  return (
    <aside
      data-testid="agent-chat-drawer"
      aria-label="Portal AI Agent & Skills"
      className="fixed right-0 top-8.5 bottom-0 z-40 flex w-full sm:w-[396px] flex-col border-l border-border bg-card shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/35 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary/15 text-primary shrink-0">
            <Bot className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground truncate">
                Portal AI Agent
              </span>
              <span className="rounded bg-primary/10 px-1 py-0.2 font-mono text-[9px] font-semibold text-primary">
                {enabledSkillIds.length}/{skillsCatalog.length} skills
              </span>
            </div>
            <div className="font-mono text-[10px] text-muted-foreground truncate">
              {context.activeAppId} · {context.viewMode} · {context.headlineVerdict}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && activeTab === 'chat' && (
            <button
              type="button"
              onClick={onClearChat}
              title="Clear conversation"
              data-testid="btn-agent-clear-chat"
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI Agent drawer"
            data-testid="btn-close-agent-drawer"
            className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-2 border-b border-border bg-background px-2 pt-1.5 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          data-testid="agent-tab-chat"
          className={`flex items-center justify-center gap-1.5 border-b-2 pb-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            activeTab === 'chat'
              ? 'border-primary text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="h-3 w-3" />
          <span>Agent Chat</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('skills')}
          data-testid="agent-tab-skills"
          className={`flex items-center justify-center gap-1.5 border-b-2 pb-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            activeTab === 'skills'
              ? 'border-primary text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Wrench className="h-3 w-3" />
          <span>Skills ({skillsCatalog.length})</span>
        </button>
      </div>

      {activeTab === 'chat' ? (
        <>
          {/* Chat Transcript */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <div className="rounded border border-border bg-muted/25 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                  <div className="font-semibold text-foreground mb-1">
                    Autonomous Release Gate Operator
                  </div>
                  Ask me to run Live Gates, diagnose HTTP/header/cookie/visual diffs,
                  create Playwright or Catchpoint monitors, accept header/cookie diffs,
                  audit Fleet health, or open VS Code.
                </div>

                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick Commands
                  </div>
                  <div className="space-y-1.5">
                    {quickPrompts.map((qp, idx) => (
                      <button
                        key={qp}
                        type="button"
                        onClick={() => void onSendMessage(qp)}
                        data-testid={`agent-quick-prompt-${idx}`}
                        className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2.5 py-1.5 text-left text-[11px] text-foreground hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <span className="truncate">{qp}</span>
                        <Play className="h-2.5 w-2.5 text-primary shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  data-testid={`agent-msg-${msg.role}`}
                  className={`rounded-md border px-2.5 py-2 text-[11px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'ml-6 border-primary/30 bg-primary/10 text-foreground'
                      : 'mr-2 border-border bg-background text-foreground/95'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground font-mono">
                    <span>{msg.role === 'user' ? 'You' : msg.model || 'Portal Agent'}</span>
                    <span>{msg.timestamp}</span>
                  </div>

                  <div className="space-y-1">
                    {msg.content.split('\n').map((line, i) => (
                      <div key={`${msg.id}-l-${i}`} className="break-words">
                        {renderFormattedLine(line, `${msg.id}-${i}`)}
                      </div>
                    ))}
                  </div>

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-border/60 pt-1.5">
                      {msg.actions.map((act, idx) => (
                        <span
                          key={`${msg.id}-act-${idx}`}
                          data-testid={`agent-executed-action-${act.type}`}
                          className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-emerald-700 dark:text-emerald-300"
                        >
                          <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                          <span>{formatActionLabel(act)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            {isBusy && (
              <div className="mr-2 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                <span>Executing skills & portal tools…</span>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-border bg-muted/20 p-2.5 space-y-1.5"
          >
            {messages.length > 0 && (
              <div className="flex flex-wrap gap-1 pb-0.5">
                {[
                  {
                    label: `Why ${context.headlineVerdict}?`,
                    prompt: `Why is ${context.activeAppId} ${context.headlineVerdict} and what drifted?`,
                  },
                  {
                    label: `Explain ${context.selectedTestId || 'T01'}`,
                    prompt: `Explain ${context.selectedTestId || 'T01'} diffs`,
                  },
                  {
                    label: 'Accept All Diffs',
                    prompt: `Accept all diffs on ${context.activeAppId}`,
                  },
                  {
                    label: 'Open Fleet Matrix',
                    prompt: `Open Fleet Matrix and summarize blockers`,
                  },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    disabled={isBusy}
                    onClick={() => void onSendMessage(chip.prompt)}
                    className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                rows={2}
                placeholder="Ask why NO-GO, explain T01, run gate, accept all diffs…"
                data-testid="agent-chat-input"
                className="flex-1 resize-none rounded border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={isBusy || !input.trim()}
                data-testid="agent-chat-send"
                className="inline-flex h-[46px] items-center justify-center rounded bg-primary px-3 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 cursor-pointer shrink-0"
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
              <span>Enter to send · ⌘J toggle</span>
              <span>{enabledSkillIds.length} active skills</span>
            </div>
          </form>
        </>
      ) : (
        /* Skills Catalog Tab */
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          <input
            type="text"
            value={skillQuery}
            onChange={(e) => setSkillQuery(e.target.value)}
            placeholder="Filter agent skills…"
            data-testid="agent-skills-search"
            className="h-7 w-full rounded border border-border bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />

          <div className="space-y-2">
            {filteredSkills.map((skill) => {
              const enabled = enabledSkillIds.includes(skill.id);
              return (
                <div
                  key={skill.id}
                  data-testid={`agent-skill-card-${skill.id}`}
                  className={`rounded border p-2.5 space-y-1.5 transition-colors ${
                    enabled
                      ? 'border-border bg-background'
                      : 'border-border/60 bg-muted/20 opacity-75'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-foreground">
                          {skill.name}
                        </span>
                        <span className="rounded bg-muted px-1 py-0.2 font-mono text-[9px] uppercase text-muted-foreground">
                          {skill.category}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] text-muted-foreground leading-snug">
                        {skill.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => onToggleSkill(skill.id)}
                      data-testid={`toggle-skill-${skill.id}`}
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium cursor-pointer ${
                        enabled
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      {enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <ul className="space-y-0.5 pl-3 text-[10px] text-muted-foreground list-disc">
                    {skill.capabilities.map((cap) => (
                      <li key={cap}>{cap}</li>
                    ))}
                  </ul>

                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                    <span className="font-mono text-[9.5px] text-muted-foreground truncate">
                      tools: {skill.toolNames.slice(0, 3).join(', ')}
                    </span>
                    <button
                      type="button"
                      disabled={!enabled || isBusy}
                      onClick={() => void handleRunSkillPrompt(skill.starterPrompt)}
                      data-testid={`btn-run-skill-${skill.id}`}
                      className="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-[10px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-45 cursor-pointer shrink-0"
                    >
                      <Play className="h-2.5 w-2.5 fill-current" />
                      <span>Run Skill</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
};
