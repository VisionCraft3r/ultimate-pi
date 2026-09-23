/**
 * Cross-provider 429 switch. Keep this file outside extensions/*.ts — Pi
 * auto-loads every top-level .ts there as an extension factory.
 *
 * HTTP 429 / rate_limit_error means that provider's consumption is gone.
 * Pi's auto-retry treats 429 as retryable on the SAME model (then "Retry
 * failed after 3 attempts"). This extension switches provider, marks the
 * error non-retryable so that loop stops, and continues on the backup.
 *
 * Resolution order (configurable, no hardcoded model ids):
 *   1. agentFallbacks[agentName] in model-agents.json  (per-agent override,
 *      "main" is the key used for the top-level orchestrator session)
 *   2. fallbacks[provider] in model-agents.json        (global per-provider chain,
 *      user-editable via `ultimate-pi setup fallbacks` / the /ModelAgents command)
 *   3. derived defaults passed in by the caller         (sane out-of-the-box
 *      ordering among whatever providers the user actually configured)
 *   4. empty chain — no fallback available, surfaced to the user as an error
 *
 * Schema note (back-compat): the OLD schema only had a flat
 * `fallbacks[provider] -> ModelRef[]` map (see the pre-1.0 FALLBACK_BY_PROVIDER
 * constant, now removed). The NEW schema adds `agentFallbacks[agentOrMain]`
 * as a higher-priority layer on top of the same `fallbacks[provider]` map —
 * existing model-agents.json files with only `fallbacks` continue to work
 * unchanged, they just never hit step 1.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { resolveFallbackChain, type ModelRef } from "./model-agents.ts";

/** Appended so Pi's isRetryableAssistantError returns false (quota exceeded + cancelled). */
const QUOTA_CANCEL_SUFFIX = "\ncancelled: quota exceeded";

/** Object that may carry a provider error without a confirmed assistant role. */
type QuotaErrorCarrier = {
  role?: string;
  errorMessage?: string;
  provider?: string;
};

/** Assistant-role payload used to detect 429s and choose the provider to leave. */
type QuotaAssistantMessage = QuotaErrorCarrier & { role: "assistant" };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asQuotaErrorCarrier(value: unknown): QuotaErrorCarrier | undefined {
  return isObject(value) ? (value as QuotaErrorCarrier) : undefined;
}

function asQuotaAssistantMessage(value: unknown): QuotaAssistantMessage | undefined {
  if (!isObject(value) || value.role !== "assistant") return undefined;
  return value as QuotaAssistantMessage;
}

function optionalStringProp(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

const exhaustedProviders = new Set<string>();
let switching = false;
let pendingContinue = false;

export function isQuota429(status?: number, text?: string): boolean {
  if (status === 429) return true;
  const t = text ?? "";
  if (!t) return false;
  return (
    /\b429\b/.test(t) ||
    /rate_limit_error/i.test(t) ||
    /exceed your account's rate limit/i.test(t) ||
    /retry failed after \d+ attempts/i.test(t)
  );
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
  try {
    ctx.ui.notify(message, type);
  } catch {
    // UI not bound yet
  }
  try {
    ctx.ui.setStatus("quota-fallback", message.slice(0, 80));
  } catch {
    // ignore
  }
}

function assistantErrorText(message: QuotaErrorCarrier | undefined): string {
  if (!message) return "";
  const err = typeof message.errorMessage === "string" ? message.errorMessage : "";
  if (message.role && message.role !== "assistant") return "";
  return err;
}

function assistantProvider(message: QuotaErrorCarrier | undefined): string | undefined {
  return typeof message?.provider === "string" ? message.provider : undefined;
}

function lastAssistantFrom(messages: readonly unknown[] | undefined): QuotaAssistantMessage | undefined {
  if (!messages?.length) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = asQuotaAssistantMessage(messages[i]);
    if (msg) return msg;
  }
  return undefined;
}

function lastAssistant(ctx: ExtensionContext, extra?: readonly unknown[]): QuotaAssistantMessage | undefined {
  const fromExtra = lastAssistantFrom(extra);
  if (fromExtra) return fromExtra;
  const entries = ctx.sessionManager?.getEntries?.() ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    const nested = isObject(entry) ? (entry.message ?? entry) : entry;
    const msg = asQuotaAssistantMessage(nested);
    if (msg) return msg;
  }
  return undefined;
}

/** Best-effort current agent name (falls back to "main" for the orchestrator). */
function currentAgentName(ctx: ExtensionContext): string {
  if (!isObject(ctx)) return "main";
  return optionalStringProp(ctx, "agentName") || optionalStringProp(ctx, "subagentName") || "main";
}

function resolveBackup(ctx: ExtensionContext, provider: string, id: string): Model<any> | undefined {
  const exact = ctx.modelRegistry.find(provider, id);
  if (exact) return exact;
  const seen = new Set<string>();
  const pool: Model<any>[] = [];
  for (const m of [
    ...(ctx.modelRegistry.getAll?.() ?? []),
    ...(ctx.modelRegistry.getAvailable?.() ?? []),
    ...(ctx.scopedModels ?? []).map((s) => s.model),
  ]) {
    const key = `${m.provider}/${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(m);
  }
  return (
    pool.find((m) => m.provider === provider && m.id === id) ??
    pool.find(
      (m) =>
        m.provider === provider &&
        (m.id.endsWith(id) || id.endsWith(m.id) || m.id.includes(id)),
    ) ??
    pool.find((m) => m.provider === provider)
  );
}

/** True if the user has any usable credentials for `provider` in this session's model registry. */
function hasCredentialsFor(ctx: ExtensionContext, provider: string): boolean {
  const pool: Model<any>[] = [
    ...(ctx.modelRegistry.getAll?.() ?? []),
    ...(ctx.modelRegistry.getAvailable?.() ?? []),
  ];
  return pool.some((m) => m.provider === provider);
}

async function switchAwayFrom(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  deadProvider: string,
  derivedDefaults: Record<string, ModelRef[]>,
): Promise<boolean> {
  if (!deadProvider || switching) return false;
  if (exhaustedProviders.has(deadProvider)) {
    const current = ctx.model;
    return Boolean(current && current.provider !== deadProvider);
  }
  exhaustedProviders.add(deadProvider);

  const current = ctx.model;
  if (current && current.provider !== deadProvider) {
    pendingContinue = true;
    return true;
  }

  const agentName = currentAgentName(ctx);
  const chain = resolveFallbackChain(deadProvider, derivedDefaults, agentName);
  switching = true;
  const failures: string[] = [];
  try {
    for (const spec of chain) {
      if (exhaustedProviders.has(spec.provider)) {
        failures.push(`${spec.provider}/${spec.id} (already exhausted)`);
        continue;
      }
      if (!hasCredentialsFor(ctx, spec.provider)) {
        failures.push(`${spec.provider}/${spec.id} (no credentials — skipped)`);
        continue;
      }
      const next = resolveBackup(ctx, spec.provider, spec.id);
      if (!next) {
        failures.push(`${spec.provider}/${spec.id} (not in registry)`);
        continue;
      }
      const ok = await pi.setModel(next);
      if (ok) {
        const from = current ? `${current.provider}/${current.id}` : deadProvider;
        const to = `${next.provider}/${next.id}`;
        notify(ctx, `429: ${from} quota gone — switched to ${to}`, "warning");
        pendingContinue = true;
        return true;
      }
      failures.push(`${spec.provider}/${spec.id} (setModel false — no auth)`);
    }
    notify(
      ctx,
      `429: ${deadProvider} quota gone — no backup provider with auth (${failures.join("; ") || "empty chain"})`,
      "error",
    );
    return false;
  } catch (err) {
    notify(ctx, `429 fallback failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    return false;
  } finally {
    switching = false;
  }
}

function poisonRetry<T extends QuotaErrorCarrier>(message: T): T {
  const err = assistantErrorText(message);
  if (!err || err.includes("quota exceeded")) return message;
  return { ...message, errorMessage: `${err}${QUOTA_CANCEL_SUFFIX}` };
}

function scheduleContinue(pi: ExtensionAPI): void {
  if (!pendingContinue) return;
  pendingContinue = false;
  setTimeout(() => {
    try {
      pi.sendUserMessage(
        "Continue from where you left off. The previous model hit a 429 quota limit and this session switched provider. Do not mention the switch unless asked.",
        { deliverAs: "followUp" },
      );
    } catch (err) {
      pendingContinue = true;
      try {
        // last-resort: leave the flag so a later settled event can retry
        console.error("[quota-fallback] continue failed:", err);
      } catch {
        // ignore
      }
    }
  }, 0);
}

/**
 * Derived defaults: a sane out-of-the-box fallback ordering built from
 * whichever providers the user actually configured, used only when neither
 * agentFallbacks nor fallbacks[provider] has an entry. Callers (the
 * jev-sentinel / quota-fallback extension entrypoints) pass this in so the
 * library stays free of any hardcoded, product-specific model ids.
 */
export function deriveDefaultChains(configuredProviders: string[]): Record<string, ModelRef[]> {
  const order = ["anthropic", "openai-codex", "cursor", "openai", "openrouter", "deepseek"];
  const available = order.filter((p) => configuredProviders.includes(p));
  const chains: Record<string, ModelRef[]> = {};
  for (const provider of available) {
    chains[provider] = available
      .filter((p) => p !== provider)
      .map((p) => ({ provider: p, id: "default" }));
  }
  return chains;
}

export function installQuotaFallback(pi: ExtensionAPI, derivedDefaults: Record<string, ModelRef[]> = {}): void {
  pi.on("after_provider_response", async (event, ctx) => {
    if (event.status !== 429) return;
    const dead = ctx.model?.provider;
    if (dead) await switchAwayFrom(pi, ctx, dead, derivedDefaults);
  });

  pi.on("message_end", async (event, ctx) => {
    const carrier = asQuotaErrorCarrier(event.message);
    const err = assistantErrorText(carrier);
    if (!isQuota429(undefined, err)) return;
    const dead = assistantProvider(carrier) ?? ctx.model?.provider;
    if (dead) await switchAwayFrom(pi, ctx, dead, derivedDefaults);
    if (!carrier) return;
    return { message: poisonRetry(event.message) };
  });

  pi.on("agent_end", async (event, ctx) => {
    const last = lastAssistant(ctx, event.messages);
    if (!isQuota429(undefined, assistantErrorText(last))) return;
    const dead = assistantProvider(last) ?? ctx.model?.provider;
    if (dead) await switchAwayFrom(pi, ctx, dead, derivedDefaults);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const last = lastAssistant(ctx);
    if (isQuota429(undefined, assistantErrorText(last))) {
      const dead = assistantProvider(last) ?? ctx.model?.provider;
      if (dead) await switchAwayFrom(pi, ctx, dead, derivedDefaults);
    }
    scheduleContinue(pi);
  });
}
