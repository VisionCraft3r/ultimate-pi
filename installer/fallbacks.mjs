import * as p from "@clack/prompts";
import { canonicalizeAnswersFields } from "./schema.mjs";

const AGENT_NAMES = ["scout", "worker", "planner", "researcher", "qa_tester"];
const SESSIONS = ["main", ...AGENT_NAMES];

const DEFAULT_ORDER = [
  "anthropic",
  "openai-codex",
  "cursor",
  "openrouter",
  "openai",
  "deepseek",
  "other",
];

function isCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Fallback setup cancelled.");
    process.exit(0);
  }
  return value;
}

function configuredIds(providers) {
  const ids = (providers ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry.id,
  );
  return DEFAULT_ORDER.filter((id) => ids.includes(id)).concat(
    ids.filter((id) => !DEFAULT_ORDER.includes(id)),
  );
}

function chainFor(providerId, providerIds) {
  return providerIds.filter((id) => id !== providerId);
}

function defaultProviderChains(providerIds) {
  const chains = {};
  for (const id of providerIds) chains[id] = chainFor(id, providerIds);
  return chains;
}

function formatChain(chain) {
  return chain.length > 0 ? chain.join(" → ") : "(none)";
}

function sessionAssignment(name, agentAssignments, providerIds) {
  if (name !== "main" && agentAssignments?.[name]) return agentAssignments[name];
  if (agentAssignments?.main) return agentAssignments.main;
  if (agentAssignments?.worker) return agentAssignments.worker;
  if (agentAssignments?.planner) return agentAssignments.planner;
  const first = providerIds[0];
  return first
    ? { provider: first, model: "(session default)" }
    : { provider: "anthropic", model: "(session default)" };
}

function chainForSession(assignment, providerChains, override) {
  if (override?.chain) return override.chain;
  return providerChains[assignment.provider] ?? [];
}

function reviewTable(providerIds, providerChains, agentAssignments, agentFallbacks) {
  const rows = SESSIONS.map((name) => {
    const assignment = sessionAssignment(name, agentAssignments, providerIds);
    const chain = chainForSession(assignment, providerChains, agentFallbacks[name]);
    const primary = `${assignment.provider} / ${assignment.model}`;
    return `${name.padEnd(12)} ${primary.padEnd(40)} ${formatChain(chain)}`;
  });
  return ["session       primary                                  429 fallbacks", ...rows].join("\n");
}

function fromAnswers(answers) {
  // Canonical answers.json shape is top-level providerChains / agentFallbacks
  // (schema.mjs, settings.mjs). Nested answers.fallbacks.providerChains is an alias.
  const { providerChains, agentFallbacks } = canonicalizeAnswersFields(answers);
  if (!providerChains || Object.keys(providerChains).length === 0) return null;
  return { providerChains, agentFallbacks };
}

async function customizeChain(label, providerIds, initial) {
  const chain = [];
  const remaining = new Set(initial?.length ? initial : providerIds);
  while (remaining.size > 0) {
    const next = isCancelled(
      await p.select({
        message: `Next 429 fallback for ${label} (or done)`,
        options: [
          { value: "__done__", label: chain.length ? "Done" : "No fallbacks" },
          ...[...remaining].map((id) => ({ value: id, label: id })),
        ],
      }),
    );
    if (next === "__done__") break;
    chain.push(next);
    remaining.delete(next);
  }
  return chain;
}

/**
 * D8: global per-provider 429 fallback chains + optional per-agent overrides.
 * Includes a "main" session row for the top-level orchestrator.
 */
export async function configureFallbacks(
  options = {},
  providers = [],
  agentAssignments = {},
) {
  const answered = fromAnswers(options.answers);
  if (answered) return answered;

  const providerIds = configuredIds(providers);
  let providerChains = defaultProviderChains(providerIds);
  let agentFallbacks = {};

  if (options.yes || options.dryRun) {
    return { providerChains, agentFallbacks };
  }

  p.note(
    Object.entries(providerChains)
      .map(([id, chain]) => `${id} → ${formatChain(chain)}`)
      .join("\n") || "(no providers configured)",
    "Default 429 fallback chains",
  );

  const useDefaults = isCancelled(
    await p.confirm({
      message: "Use default per-provider 429 fallback chains?",
      initialValue: true,
    }),
  );

  if (!useDefaults) {
    providerChains = {};
    for (const id of providerIds) {
      providerChains[id] = await customizeChain(id, chainFor(id, providerIds));
    }
  }

  const customizeAgents = isCancelled(
    await p.confirm({
      message: "Add per-agent fallback overrides?",
      initialValue: false,
    }),
  );

  if (customizeAgents) {
    for (const name of SESSIONS) {
      const override = isCancelled(
        await p.confirm({
          message: `Override fallback chain for ${name}?`,
          initialValue: false,
        }),
      );
      if (!override) continue;
      const assignment = sessionAssignment(name, agentAssignments, providerIds);
      agentFallbacks[name] = {
        chain: await customizeChain(
          name,
          providerIds,
          chainFor(assignment.provider, providerIds),
        ),
      };
    }
  }

  p.note(
    reviewTable(providerIds, providerChains, agentAssignments, agentFallbacks),
    "Fallback review (includes main session)",
  );

  isCancelled(
    await p.confirm({
      message: "Write these fallback chains?",
      initialValue: true,
    }),
  );

  return { providerChains, agentFallbacks };
}
