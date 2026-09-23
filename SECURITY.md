# Security Policy

## Reporting a vulnerability

Do **not** open a public GitHub issue for secrets, leaked credentials, or other security reports.

Please report vulnerabilities privately:

1. Use [GitHub Security Advisories](https://github.com/VisionCraft3r/ultimate-pi/security/advisories/new) on this repository, or
2. Open a **private** maintainer contact if GitHub advisories are unavailable.

Include what you found, how to reproduce it, and the impact. We will acknowledge the report and work on a fix before any public disclosure.

## Never commit secrets

Never commit:

- `auth.json` (including `**/auth.json`)
- API keys, tokens, cookies, or OAuth credentials
- `.env*` files, `*.key` files, or other credential material
- Personal filesystem paths or identifying machine data

Provider credentials belong in the local Pi `auth.json` (gitignored, mode `0600`) or in environment variables. The installer and docs never ask you to put secrets in the repo.

## Automated gates

Every commit and CI run is gated by:

- `scripts/scan-secrets.mjs` — rejects credential-shaped strings
- `scripts/scan-personal.mjs` — rejects personal paths and identifying tokens

Run them via `npm run scan` before you push. A scan failure means the change must not be merged.
