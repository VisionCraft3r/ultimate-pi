import { useEffect, useState } from "react";
import { usePluginAction, usePluginData, type PluginCompanySettingsPageProps, type PluginSidebarProps, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

type Persona = {
  name: string;
  description: string;
  model: string;
  thinking: string;
  tools: string;
  source: string;
};

type SetupData = {
  agentDir: string;
  scopedModels: string[];
  catalog: string[];
  personas: Persona[];
  fallbacks: { fallbacks?: Record<string, Array<{ provider: string; id: string }>> };
};

const HIRE_KEYS = ["orchestrator", "scout", "worker", "planner", "researcher", "qa_tester"];

export function UltimatePiSetup({ context }: PluginCompanySettingsPageProps) {
  const { data, loading, error, refresh } = usePluginData<SetupData>("setup");
  const saveScope = usePluginAction("saveScope");
  const savePersonaModel = usePluginAction("savePersonaModel");
  const savePersonaThinking = usePluginAction("savePersonaThinking");
  const saveFallback = usePluginAction("saveFallback");
  const hire = usePluginAction("hire");
  const resetOrg = usePluginAction("resetOrg");
  const [selected, setSelected] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");

  if (loading) return <p>Loading Ultimate PI setup…</p>;
  if (error) return <p>Ultimate PI setup failed: {error.message}</p>;
  if (!data) return <p>No Ultimate PI data.</p>;

  const scoped = selected ?? data.scopedModels;
  const catalog = data.catalog.length > 0 ? data.catalog : data.scopedModels;

  function toggle(model: string) {
    setSelected((current) => {
      const base = current ?? data?.scopedModels ?? [];
      return base.includes(model) ? base.filter((entry) => entry !== model) : [...base, model];
    });
  }

  return (
    <section>
      <h1>Ultimate PI</h1>
      <p>Agent directory {data.agentDir}. Scoped models are the only models personas and 429 fallbacks may use.</p>
      <p>Skills are turned on and off on an agent’s Skills page. That switch applies to every Pi session.</p>
      <p>On an agent, Harness sets the persona, model, thinking, and run timeout. A harness model or thinking change is written into the persona file, so it also applies to a normal local pi session. Environment variables are passed into the tmux session. Instructions are added to the Pi prompt. The working directory is the project workspace for the task.</p>
      <button
        type="button"
        onClick={() => {
          if (!context.companyId) {
            setMessage("Open this page inside a company.");
            return;
          }
          void resetOrg({ companyId: context.companyId }).then(() => {
            setMessage("Reset the org to Ultimate PI defaults.");
            refresh();
          }).catch((err: Error) => setMessage(err.message));
        }}
      >
        Reset org to Ultimate PI defaults
      </button>
      {message ? <p>{message}</p> : null}
      <h2>Scoped models</h2>
      <ul>
        {catalog.map((model) => (
          <li key={model}>
            <label>
              <input
                type="checkbox"
                checked={scoped.includes(model)}
                onChange={() => toggle(model)}
              />
              {model}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          void saveScope({ models: scoped }).then(() => {
            setMessage("Saved scoped models.");
            setSelected(null);
            refresh();
          }).catch((err: Error) => setMessage(err.message));
        }}
      >
        Save scoped models
      </button>
      <h2>Default agents</h2>
      {data.personas.map((persona) => (
        <article key={persona.name}>
          <h3>{persona.name}</h3>
          <p>{persona.description}</p>
          <p>{persona.tools ? `Tools: ${persona.tools}` : "Orchestrator keeps the full tool set so tmux subagents can spawn."}</p>
          {persona.name === "orchestrator" ? null : (
            <label>
              Thinking
              <select
                value={["off", "minimal", "low", "medium", "high", "xhigh"].includes(persona.thinking) ? persona.thinking : ""}
                onChange={(event) => {
                  const thinking = event.target.value;
                  if (!thinking) return;
                  void savePersonaThinking({ persona: persona.name, thinking }).then(() => {
                    setMessage(`${persona.name} thinking → ${thinking}`);
                    refresh();
                  }).catch((err: Error) => setMessage(err.message));
                }}
              >
                <option value="">Thinking level</option>
                {["off", "minimal", "low", "medium", "high", "xhigh"].map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
            </label>
          )}
          {persona.name === "orchestrator" ? null : (
            <label>
              Model
              <select
                value={scoped.includes(persona.model) ? persona.model : ""}
                onChange={(event) => {
                  const model = event.target.value;
                  if (!model) return;
                  void savePersonaModel({ persona: persona.name, model }).then(() => {
                    setMessage(`${persona.name} → ${model}`);
                    refresh();
                  }).catch((err: Error) => setMessage(err.message));
                }}
              >
                <option value="">Choose a scoped model</option>
                {scoped.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>
          )}
          {HIRE_KEYS.includes(persona.name) ? (
            <button
              type="button"
              onClick={() => {
                if (!context.companyId) {
                  setMessage("Open this page inside a company.");
                  return;
                }
                void hire({ agentKey: persona.name, companyId: context.companyId }).then(() => {
                  setMessage(`Hired ${persona.name}.`);
                }).catch((err: Error) => setMessage(err.message));
              }}
            >
              Hire {persona.name}
            </button>
          ) : null}
        </article>
      ))}
      <h2>429 fallbacks</h2>
      {["anthropic", "openai-codex", "cursor", "openai", "openrouter", "deepseek"].map((provider) => {
        const chain = data.fallbacks.fallbacks?.[provider] ?? [];
        return (
          <div key={provider}>
            <span>{provider}</span>
            {[0, 1].map((index) => (
              <select
                key={index}
                value={chain[index] ? `${chain[index].provider}/${chain[index].id}` : ""}
                onChange={(event) => {
                  const next = chain.map((spec) => `${spec.provider}/${spec.id}`);
                  next[index] = event.target.value;
                  const cleaned = next.filter(Boolean);
                  if (cleaned.length < 2) return;
                  void saveFallback({ provider, chain: cleaned }).then(() => {
                    setMessage(`${provider} fallback saved.`);
                    refresh();
                  }).catch((err: Error) => setMessage(err.message));
                }}
              >
                <option value="">Backup {index + 1}</option>
                {scoped.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ))}
          </div>
        );
      })}
    </section>
  );
}

type Choice = { id: string; label: string; freeText?: boolean };
type Asked = {
  issueId: string;
  interactionId: string;
  title: string;
  questions: Array<{ id: string; prompt: string; selectionMode: "single" | "multi"; allowOther: boolean; options: Choice[] }>;
};

function QuestionForm({ questions }: { questions: Asked[] }) {
  const { data, refresh } = usePluginData<Asked[]>("questions");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const pending = questions.length > 0 ? questions : data ?? [];

  useEffect(() => {
    const timer = setInterval(() => refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (pending.length === 0) return null;

  async function submit(item: Asked) {
    const answers = item.questions.map((question) => ({
      questionId: question.id,
      optionIds: picked[question.id] ?? [],
      otherText: other[question.id]?.trim() || null,
    }));
    const response = await fetch(`/api/issues/${item.issueId}/interactions/${item.interactionId}/respond`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    if (!response.ok) {
      setError(`Could not save the answer (${response.status}).`);
      return;
    }
    setError("");
    refresh();
  }

  const card = (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", zIndex: 80 }}>
      <form style={{ width: "min(520px, calc(100% - 32px))", background: "white", color: "#111", borderRadius: 12, padding: 20, display: "grid", gap: 16 }} onSubmit={(event) => { event.preventDefault(); const first = pending[0]; if (first) void submit(first); }}>
        <strong>{pending[0]?.title || "Question"}</strong>
        {pending[0]?.questions.map((question) => (
          <fieldset key={question.id} style={{ display: "grid", gap: 8, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <legend>{question.prompt}</legend>
            {question.options.map((option) => (
              <label key={option.id}>
                <input
                  type={question.selectionMode === "multi" ? "checkbox" : "radio"}
                  name={question.id}
                  checked={(picked[question.id] ?? []).includes(option.id)}
                  onChange={() => {
                    setPicked((current) => {
                      const selected = current[question.id] ?? [];
                      const next = question.selectionMode === "multi"
                        ? selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id]
                        : [option.id];
                      return { ...current, [question.id]: next };
                    });
                  }}
                /> {option.label}
              </label>
            ))}
            {question.allowOther ? (
              <label>
                Other
                <input value={other[question.id] ?? ""} placeholder="Type another answer" onChange={(event) => setOther((current) => ({ ...current, [question.id]: event.target.value }))} />
              </label>
            ) : null}
          </fieldset>
        ))}
        {error ? <p>{error}</p> : null}
        <button type="submit">Send answer</button>
      </form>
    </div>
  );
  return card;
}

type RunningPane = { paneId: string; label: string; command: string; primary: boolean };
type RunningSession = { session: string; agentId: string; agentName: string; panes: RunningPane[] };
type RunningMirror = { id: string; identifier: string; title: string; status: string };
type RunningData = { sessions: RunningSession[]; mirrors: RunningMirror[] };

function RunningPanel({ companyId }: { companyId?: string }) {
  const { data, refresh } = usePluginData<RunningData>("running", companyId ? { companyId } : undefined);
  const stopAgent = usePluginAction("stopAgent");
  const stopPane = usePluginAction("stopPane");
  const stopAll = usePluginAction("stopAll");
  const [error, setError] = useState("");
  const sessions = data?.sessions ?? [];
  const mirrors = data?.mirrors ?? [];

  useEffect(() => {
    const timer = setInterval(() => refresh(), 4000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (sessions.length === 0 && mirrors.length === 0) return null;

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const subagentCount = sessions.reduce((total, session) => total + session.panes.filter((pane) => !pane.primary).length, 0);

  return (
    <section style={running.card} aria-label="Running agents">
      <header style={running.header}>
        <span style={running.title}>
          <span style={running.liveDot} aria-hidden />
          Running
          <span style={running.count}>{sessions.length + subagentCount}</span>
        </span>
        {sessions.length > 0 ? (
          <button type="button" style={running.stopAll} onClick={() => void run(() => stopAll({ companyId }))}>
            Stop all
          </button>
        ) : null}
      </header>
      <ul style={running.list}>
        {sessions.map((session) => {
          const panes = session.panes.filter((pane) => !pane.primary);
          return (
            <li key={session.session} style={running.session}>
              <div style={running.row}>
                <span style={running.avatar} aria-hidden>{initials(session.agentName)}</span>
                <span style={running.nameBlock}>
                  <span style={running.name}>{session.agentName}</span>
                  <span style={running.meta}>{panes.length === 0 ? "Working" : `${panes.length} subagent${panes.length === 1 ? "" : "s"}`}</span>
                </span>
                <button type="button" style={running.stop} title={`Stop ${session.agentName} and its subagents`} onClick={() => void run(() => stopAgent({ session: session.session, companyId }))}>
                  Stop
                </button>
              </div>
              {panes.length > 0 ? (
                <ul style={running.panes}>
                  {panes.map((pane) => (
                    <li key={pane.paneId} style={running.pane}>
                      <span style={running.paneDot} aria-hidden />
                      <span style={running.paneLabel} title={pane.label}>{pane.label}</span>
                      <button type="button" style={running.stop} title={`Stop ${pane.label}`} onClick={() => void run(() => stopPane({ session: session.session, paneId: pane.paneId, companyId }))}>
                        Stop
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {mirrors.length > 0 ? (
        <ul style={running.mirrors}>
          {mirrors.map((issue) => (
            <li key={issue.id} style={running.mirror}>
              <span style={running.identifier}>{issue.identifier}</span>
              <span style={running.paneLabel} title={issue.title}>{issue.title}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p style={running.error}>{error}</p> : null}
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2)).toUpperCase();
}

const stopButton = {
  flexShrink: 0,
  border: "1px solid color-mix(in oklab, var(--destructive, #e5484d) 35%, transparent)",
  background: "transparent",
  color: "var(--destructive, #e5484d)",
  borderRadius: 6,
  padding: "2px 8px",
  fontSize: 12,
  fontWeight: 500,
  lineHeight: "18px",
  cursor: "pointer",
} as const;

const running = {
  card: {
    border: "1px solid var(--border, rgba(127,127,127,0.2))",
    borderRadius: "var(--radius, 8px)",
    background: "var(--card, transparent)",
    color: "var(--foreground, inherit)",
    padding: 10,
    margin: "8px 0",
    display: "grid",
    gap: 8,
    fontSize: 13,
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted-foreground, inherit)" },
  liveDot: { width: 8, height: 8, borderRadius: 999, background: "#22c55e", boxShadow: "0 0 0 3px color-mix(in oklab, #22c55e 25%, transparent)" },
  count: { fontSize: 11, fontWeight: 600, letterSpacing: 0, padding: "0 6px", borderRadius: 999, background: "var(--muted, rgba(127,127,127,0.15))", color: "var(--foreground, inherit)", lineHeight: "18px" },
  stopAll: { ...stopButton, background: "color-mix(in oklab, var(--destructive, #e5484d) 12%, transparent)" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 },
  session: { display: "grid", gap: 4 },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 6, background: "var(--muted, rgba(127,127,127,0.1))" },
  avatar: { width: 24, height: 24, borderRadius: 6, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, background: "var(--accent, rgba(127,127,127,0.2))", color: "var(--foreground, inherit)", flexShrink: 0 },
  nameBlock: { display: "grid", minWidth: 0, flex: 1 },
  name: { fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  meta: { fontSize: 11, color: "var(--muted-foreground, inherit)" },
  stop: stopButton,
  panes: { listStyle: "none", margin: "0 0 0 17px", padding: "0 0 0 12px", borderLeft: "1px solid var(--border, rgba(127,127,127,0.2))", display: "grid", gap: 2 },
  pane: { display: "flex", alignItems: "center", gap: 8, padding: "4px 0" },
  paneDot: { width: 6, height: 6, borderRadius: 999, background: "#22c55e", flexShrink: 0 },
  paneLabel: { flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  mirrors: { listStyle: "none", margin: 0, padding: "6px 0 0", borderTop: "1px solid var(--border, rgba(127,127,127,0.2))", display: "grid", gap: 2 },
  mirror: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted-foreground, inherit)" },
  identifier: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
  error: { margin: 0, fontSize: 12, color: "var(--destructive, #e5484d)" },
} as const;

export function QuestionSidebar({ context }: PluginSidebarProps) {
  return (
    <>
      <RunningPanel companyId={context.companyId ?? undefined} />
      <QuestionForm questions={[]} />
    </>
  );
}

export function QuestionDashboard(_props: PluginWidgetProps) {
  return null;
}

export function RunningDashboard({ context }: PluginWidgetProps) {
  return <RunningPanel companyId={context.companyId ?? undefined} />;
}

