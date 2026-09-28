# JEV routing

JEV is the classifier that sits in front of Ultimate Pi's orchestrator. Every user request is passed through the `jev_triage` tool (and, in child sessions, `jev_sentinel`). The result is a routing **tier** plus a confidence percentage. The orchestrator then either answers in the main session or launches the matching subagent role. See [docs/architecture.md](./architecture.md) for the pane/handoff picture.

## What JEV is

**Jev is a proprietary System One decision model by [TypeSafe AI](https://typesafe.ai/), accessed via [OpenRouter](https://openrouter.ai/). Jev itself and its model weights are not included in Ultimate Pi and are not licensed under Ultimate Pi's MIT license.**

Ultimate Pi is not affiliated with TypeSafe AI or OpenRouter.

When an OpenRouter API key is configured, Ultimate Pi calls OpenRouter's documented alpha Decisions API:

| | Default |
|---|---|
| Model id | `typesafe/jev-1.13` |
| Endpoint | `POST https://openrouter.ai/api/alpha/decisions` |

The call is a client-only integration: this repository does not bundle Jev weights, a TypeSafe account, or an OpenRouter key. You bring your own OpenRouter key; usage is billed per call on *your* OpenRouter account. OpenRouter currently documents that anyone with an OpenRouter key can use this model id — no separate TypeSafe waitlist is required for that path — but model availability and billing are OpenRouter's, not Ultimate Pi's.

Docs: [TypeSafe AI](https://typesafe.ai/), [TypeSafe docs](https://docs.typesafe.ai/), [OpenRouter Jev hub](https://openrouter.ai/docs/guides/community/jev). Terms that apply are yours: [OpenRouter Terms](https://openrouter.ai/terms) and [TypeSafe AI Terms of Use](https://typesafe.ai/terms).

## Tiers

`jev_triage` returns one of these public routing keys. Pass the user's wording **verbatim** — the tool attaches the previous user turn as `prior_request` when the new turn looks like a continuation.

| Tier | Meaning | Routes to |
|---|---|---|
| `tier_0` | Answer directly; no subagent | Orchestrator / main session |
| `tier_1` | A single, obviously local fix | One `worker` |
| `tier_2` | Needs a location scout first | `scout`, then `worker` |
| `tier_3` | New subsystem or architecture | `planner` → spec-ready review → `worker`s |
| `tier_4_qa` | Needs a live browser/UI | `qa_tester` |

`researcher` is not a JEV tier. The orchestrator spawns it when external docs or web research are needed.

Short continuation crumbs ("ok", "ship it", "alright") short-circuit to `tier_0` at confidence 100 so they cannot restart a plan.

## UI detection (`tier_4_qa`)

QA is a **separate** JEV question (`is_ui_test`, a `noul`) so the word "click" in a bug report cannot steal the route into `tier_4_qa`. The main choice question only returns `tier_0`…`tier_3`. Code composes the public key:

- `noul >= 0.75` **and**
- UI-test confidence `>= 0.7` (if the API omits confidence, noul alone is enough)

then the result is `tier_4_qa`. Otherwise the `task_tier` choice stands.

Constants live in `extensions/jev-triage.ts` as `UI_TEST_NOUL_THRESHOLD = 0.75` and `UI_TEST_CONFIDENCE_THRESHOLD = 0.7`.

## Low-confidence warnings

Confidence is printed as a percentage. Below the floor for that tier, the tool still returns the choice but prefixes a warning that the orchestrator **must** confirm with `ask_question` before routing:

| Choice | Low-confidence floor |
|---|---|
| `tier_3`, `tier_4_qa` | below **70%** |
| all other tiers | below **50%** |

Example: `Triage Result: tier_3. WARNING: Low confidence (62%). Orchestrator MUST use ask_question to verify this tier.`

## Heuristic fallback

The TypeSafe model is **not** called when:

- no OpenRouter key is resolved (`OPENROUTER_API_KEY` env, else `<agentDir>/auth.json` → `openrouter.key`), or
- the Decisions API returns a non-OK HTTP status, a malformed body, or a network error.

In those cases `lib/jev-heuristic.ts` runs a local **keyword** classifier (`classifyHeuristic`). That file is not Jev, not TypeSafe's, and not a substitute for the model.

Heuristic results always carry a **visible** warning so they cannot be mistaken for a live JEV call:

- no key: `⚠ JEV not configured — heuristic routing (run \`ultimate-pi setup jev\`).`
- API/network miss: `⚠ JEV unavailable (<reason>).`

Heuristic confidence is **capped at 60**. Combined with the 70% floor on `tier_3` / `tier_4_qa`, a heuristic plan-or-QA classification is always a low-confidence warning. Unmatched prompts come back as `tier_1` at confidence 45 (also a warning).

Configure a key with `ultimate-pi setup jev` (or include `openrouter` in `ultimate-pi setup providers`). Skipping the key is valid; routing still works, just coarsely, with the warning on every call.

## Env overrides

| Variable | Default |
|---|---|
| `ULTIMATE_PI_JEV_MODEL` | `typesafe/jev-1.13` |
| `ULTIMATE_PI_JEV_ENDPOINT` | `https://openrouter.ai/api/alpha/decisions` |

Defined in `lib/jev-config.ts`. Empty/whitespace values fall back to the defaults. Auth is separate: `OPENROUTER_API_KEY` wins over `auth.json` (`lib/openrouter-auth.ts`).

## Credit and license

**Jev is a proprietary System One decision model by [TypeSafe AI](https://typesafe.ai/), accessed via [OpenRouter](https://openrouter.ai/). Jev itself and its model weights are not included in Ultimate Pi and are not licensed under Ultimate Pi's MIT license.**

Ultimate Pi is not affiliated with TypeSafe AI or OpenRouter.

This package ships only the client (`jev_triage` / `jev_sentinel`, the heuristic fallback, and installer wiring). Using live JEV requires a bring-your-own OpenRouter API key and is billed per call on that account. See [NOTICE.md](../NOTICE.md) for the full credit list and linked terms.

## Related

- [docs/architecture.md](./architecture.md) — routing diagram and planner handoff
- [docs/providers.md](./providers.md) — OpenRouter key capture
- [docs/troubleshooting.md](./troubleshooting.md) — heuristic mode when you expected live JEV
