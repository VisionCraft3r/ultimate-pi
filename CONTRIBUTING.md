# Contributing to Ultimate Pi

Thanks for contributing. This document covers local setup, the checks that must pass before a commit, and how we expect pull requests to look.

## Development setup

```bash
git clone https://github.com/VisionCraft3r/ultimate-pi.git
cd ultimate-pi
npm install
```

Node.js **>= 22.19** is required. Use the same major version CI runs (Node 22).

## Checks

Run these locally before opening a PR. All of them must pass.

| Command | What it does |
| --- | --- |
| `npm test` | Runs `node:test` files under `test/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run scan` | `scripts/scan-secrets.mjs` then `scripts/scan-personal.mjs` |
| `npm run smoke` | Installer dry-run smoke test |

`npm run scan` **must pass before any commit**. It is the last line of defense against secrets and personal strings landing in the public tree.

## Secrets and personal data

PRs must never include:

- Real API keys, tokens, or cookies
- `auth.json` (or any `**/auth.json`)
- Personal filesystem paths (`/Users/<name>/...`, `/home/<name>/...`)
- Machine names, emails, or other identifying strings

Use env vars or the installer's local `auth.json` (gitignored, mode `0600`) for credentials. If a test needs a secret-shaped value, use an obvious placeholder.

## Commit messages

Use [conventional commits](https://www.conventionalcommits.org/):

- `feat:` new capability
- `fix:` bug fix
- `docs:` documentation only
- `chore:` tooling, deps, or repo hygiene
- `test:` tests only
- `refactor:` no behavior change

Keep the subject to one line. Put detail in the body when it helps reviewers.

## Pull requests

1. Branch from the default branch.
2. Keep the diff focused.
3. Run `npm test`, `npm run typecheck`, `npm run scan`, and `npm run smoke`.
4. Fill in `.github/PULL_REQUEST_TEMPLATE.md`.

See [SECURITY.md](SECURITY.md) for how to report a vulnerability (do not open a public issue for secrets).
