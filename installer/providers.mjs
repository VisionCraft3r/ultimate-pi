import * as p from "@clack/prompts";

const LOCAL_CHOICE = "__local__";
const LOCAL_PLACEHOLDER_KEY = "local";
const DEFAULT_LOCAL_API = "openai-completions";
const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const PROVIDER_CHOICES = [
  { value: "anthropic", label: "Anthropic (OAuth /login)" },
  { value: "openai-codex", label: "OpenAI Codex (OAuth /login)" },
  { value: "cursor", label: "Cursor (OAuth /login)" },
  { value: "openrouter", label: "OpenRouter (API key)" },
  { value: "deepseek", label: "DeepSeek (API key)" },
  { value: "openai", label: "OpenAI (API key)" },
  { value: "other", label: "Other (API key)" },
  { value: LOCAL_CHOICE, label: "Local model (OpenAI-compatible)" },
];

const RESERVED_PROVIDER_IDS = new Set(
  PROVIDER_CHOICES.map((choice) => choice.value).filter((value) => value !== LOCAL_CHOICE),
);

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

function modelIdsFromEntry(entry) {
  if (!entry || typeof entry !== "object") return [];
  if (Array.isArray(entry.models)) {
    return entry.models
      .map((model) => {
        if (typeof model === "string") return model.trim();
        if (model && typeof model.id === "string") return model.id.trim();
        return "";
      })
      .filter(Boolean);
  }
  if (typeof entry.model === "string" && entry.model.trim()) return [entry.model.trim()];
  return [];
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A provider entry is a local endpoint when it carries a base URL, an API
 * name, or a model list. `model` (string) is a one-element `models` list.
 * Missing credentials become the placeholder `local`.
 */
export function normalizeLocalProvider(entry) {
  if (!entry || typeof entry !== "object") return undefined;
  const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "";
  const models = modelIdsFromEntry(entry);
  const api = typeof entry.api === "string" ? entry.api.trim() : "";
  if (!baseUrl && !api && models.length === 0) return undefined;

  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(
      `local provider id "${id}" must match ${PROVIDER_ID_PATTERN} (lowercase slug)`,
    );
  }
  if (RESERVED_PROVIDER_IDS.has(id)) {
    throw new Error(
      `provider id "${id}" is reserved for a built-in provider and cannot be used as a local endpoint`,
    );
  }
  if (!isHttpUrl(baseUrl)) {
    throw new Error(`local provider "${id}" needs an http(s) baseUrl`);
  }
  if (models.length === 0) {
    throw new Error(`local provider "${id}" needs at least one model id`);
  }
  const credential =
    typeof entry.credential === "string" && entry.credential.trim()
      ? entry.credential.trim()
      : LOCAL_PLACEHOLDER_KEY;
  return {
    id,
    authMethod: "api-key",
    baseUrl,
    api: api || DEFAULT_LOCAL_API,
    models,
    credential,
  };
}

function providersFromAnswers(answers) {
  const list = answers?.providers;
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((entry) => {
    if (typeof entry !== "string") {
      const local = normalizeLocalProvider(entry);
      if (local) return local;
    }
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

function providerId(provider) {
  return typeof provider === "string" ? provider : provider?.id;
}

function providerCredential(provider) {
  return typeof provider === "string" ? undefined : provider?.credential;
}

function providerAuthMethod(provider) {
  const id = providerId(provider);
  if (typeof provider === "string" || provider?.authMethod == null) return authMethodFor(id);
  return normalizeAuthMethod(provider.authMethod, id);
}

function authHasProvider(auth, id) {
  if (!auth || typeof auth !== "object" || !id) return false;
  const entry = auth[id];
  if (entry == null) return false;
  if (typeof entry === "object") return Object.keys(entry).length > 0;
  return true;
}

/**
 * Providers that have neither a captured credential nor an auth.json entry.
 * Does not change the collectProviders return shape.
 */
export function providersMissingAuth(providers, auth = {}) {
  return (providers ?? []).filter((provider) => {
    const id = providerId(provider);
    if (!id) return false;
    const credential = providerCredential(provider);
    if (typeof credential === "string" && credential.trim()) return false;
    if (authHasProvider(auth, id)) return false;
    return true;
  });
}

/** Message for `--yes` when selected providers are not authenticated. Null if ready. */
export function yesModeAuthError(providers, auth = {}) {
  const missing = providersMissingAuth(providers, auth);
  if (missing.length === 0) return null;
  const ids = missing.map((provider) => providerId(provider)).filter(Boolean);
  const listed = ids.join(", ");
  const oauthIds = missing
    .filter((provider) => providerAuthMethod(provider) === "oauth")
    .map((provider) => providerId(provider))
    .filter(Boolean);
  const prefix =
    oauthIds.length === missing.length
      ? `Run \`pi login\` for ${listed} first, then re-run install.`
      : `Auth is not ready for ${listed}. For OAuth providers run \`pi login\` first; for API-key providers add a key, then re-run install.`;
  return `${prefix} No settings or packages were applied.`;
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

async function promptProviderId(selected) {
  const id = isCancelled(
    await p.text({
      message: "Provider id",
      placeholder: "local",
      initialValue: "local",
      validate: (value) => {
        const slug = value?.trim() ?? "";
        if (!PROVIDER_ID_PATTERN.test(slug)) return "Use a lowercase slug: letters, numbers, _ or -";
        if (RESERVED_PROVIDER_IDS.has(slug)) return `${slug} is a built-in provider`;
        if (selected.has(slug)) return `${slug} is already configured`;
        return undefined;
      },
    }),
  );
  return id.trim();
}

async function promptModelIds() {
  const models = [];
  const first = isCancelled(
    await p.text({
      message: "Model id served by this endpoint",
      placeholder: "qwen2.5-coder:7b",
      validate: (value) => (value?.trim() ? undefined : "Model id is required"),
    }),
  );
  models.push(first.trim());
  while (true) {
    const another = isCancelled(
      await p.confirm({
        message: "Add another model on this endpoint?",
        initialValue: false,
      }),
    );
    if (!another) break;
    const next = isCancelled(
      await p.text({
        message: "Additional model id",
        validate: (value) => (value?.trim() ? undefined : "Model id is required"),
      }),
    );
    const id = next.trim();
    if (!models.includes(id)) models.push(id);
  }
  return models;
}

async function collectLocal(options, selected) {
  const id = await promptProviderId(selected);
  const baseUrlInput = isCancelled(
    await p.text({
      message: "Base URL",
      initialValue: DEFAULT_LOCAL_BASE_URL,
      placeholder: DEFAULT_LOCAL_BASE_URL,
      validate: (value) =>
        isHttpUrl(value?.trim() ?? "") ? undefined : "Base URL must start with http:// or https://",
    }),
  );
  const models = await promptModelIds();
  let credential = LOCAL_PLACEHOLDER_KEY;
  if (!options.dryRun) {
    const key = isCancelled(
      await p.password({
        message: `API key for ${id} (empty uses placeholder "${LOCAL_PLACEHOLDER_KEY}")`,
        mask: "•",
      }),
    );
    if (key?.trim()) credential = key.trim();
  }
  selected.add(id);
  return {
    id,
    authMethod: "api-key",
    baseUrl: baseUrlInput.trim(),
    api: DEFAULT_LOCAL_API,
    models,
    credential,
  };
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
    if (id === LOCAL_CHOICE) {
      providers.push(await collectLocal(options, selected));
      continue;
    }
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

    const remaining = PROVIDER_CHOICES.filter(
      (choice) => choice.value === LOCAL_CHOICE || !selected.has(choice.value),
    );
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
    if (next === LOCAL_CHOICE) {
      providers.push(await collectLocal(options, selected));
      continue;
    }
    selected.add(next);
    providers.push(await collectOne(next, options));
  }

  return { providers };
}
