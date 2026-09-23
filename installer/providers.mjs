import * as p from "@clack/prompts";

const PROVIDER_CHOICES = [
  { value: "anthropic", label: "Anthropic (OAuth /login)" },
  { value: "openai-codex", label: "OpenAI Codex (OAuth /login)" },
  { value: "cursor", label: "Cursor (OAuth /login)" },
  { value: "openrouter", label: "OpenRouter (API key)" },
  { value: "deepseek", label: "DeepSeek (API key)" },
  { value: "openai", label: "OpenAI (API key)" },
  { value: "other", label: "Other (API key)" },
];

const OAUTH_PROVIDERS = new Set(["anthropic", "openai-codex", "cursor"]);
const API_KEY_PROVIDERS = new Set(["openrouter", "deepseek", "openai", "other"]);

function isCancelled(value) {
  if (p.isCancel(value)) {
    p.cancel("Provider setup cancelled.");
    process.exit(0);
  }
  return value;
}

function authMethodFor(id) {
  return OAUTH_PROVIDERS.has(id) ? "oauth" : "api-key";
}

/** Canonical installer auth method: `oauth` or `api-key`. */
function normalizeAuthMethod(raw, id) {
  if (raw == null || String(raw).trim() === "") return authMethodFor(id);
  const canonical = String(raw).trim().toLowerCase().replace(/_/g, "-");
  if (canonical === "api-key" || canonical === "apikey") return "api-key";
  if (canonical === "oauth" || canonical === "o-auth") return "oauth";
  return authMethodFor(id);
}

function providersFromAnswers(answers) {
  const list = answers?.providers;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((entry) => {
    const id = typeof entry === "string" ? entry : entry.id;
    const rawMethod = typeof entry === "string" ? undefined : entry.authMethod;
    const authMethod = normalizeAuthMethod(rawMethod, id);
    const out = { id, authMethod };
    const credential = typeof entry === "string" ? undefined : entry.credential;
    if (authMethod === "api-key" && typeof credential === "string" && credential) {
      out.credential = credential;
    }
    return out;
  });
}

async function promptApiKey(id) {
  const credential = isCancelled(
    await p.password({
      message: `API key for ${id}`,
      mask: "•",
      validate: (value) => (value?.trim() ? undefined : "API key is required"),
    }),
  );
  return credential.trim();
}

async function promptOAuth(id) {
  p.note(
    [
      `OAuth for ${id} is handled by pi's interactive login.`,
      "1. In another terminal (or after this prompt), run: pi",
      "2. At the pi prompt, run: /login",
      `3. Complete the ${id} login flow, then return here.`,
    ].join("\n"),
    `${id} OAuth`,
  );
  isCancelled(
    await p.confirm({
      message: `Press Enter / confirm after /login for ${id} succeeded`,
      initialValue: true,
    }),
  );
}

async function collectOne(id, options) {
  const authMethod = authMethodFor(id);
  const result = { id, authMethod };

  if (options.dryRun) {
    return result;
  }

  if (API_KEY_PROVIDERS.has(id)) {
    result.credential = await promptApiKey(id);
  } else if (OAUTH_PROVIDERS.has(id)) {
    await promptOAuth(id);
  }

  return result;
}

/**
 * Provider selection + "add another provider?" loop (spec §1.2 / §4).
 * Credentials are captured here; writing auth.json is installer/auth-store.mjs.
 */
export async function collectProviders(options = {}) {
  const fromAnswers = providersFromAnswers(options.answers);
  if (fromAnswers) {
    return { providers: fromAnswers };
  }

  if (options.yes) {
    return {
      providers: ["anthropic", "openai-codex", "cursor"].map((id) => ({
        id,
        authMethod: authMethodFor(id),
      })),
    };
  }

  const providers = [];
  const selected = new Set();

  const initial = isCancelled(
    await p.multiselect({
      message: "Select providers to configure",
      options: PROVIDER_CHOICES,
      required: true,
    }),
  );

  for (const id of initial) {
    selected.add(id);
    providers.push(await collectOne(id, options));
  }

  while (true) {
    const addAnother = isCancelled(
      await p.confirm({
        message: "Add another provider?",
        initialValue: false,
      }),
    );
    if (!addAnother) break;

    const remaining = PROVIDER_CHOICES.filter((c) => !selected.has(c.value));
    if (remaining.length === 0) {
      p.log.info("All known providers are already selected.");
      break;
    }

    const next = isCancelled(
      await p.select({
        message: "Additional provider",
        options: remaining,
      }),
    );
    selected.add(next);
    providers.push(await collectOne(next, options));
  }

  return { providers };
}
