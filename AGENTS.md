# AGENTS.md

## Scope

`dsh-agent-plugin-market` is a dual-face DSH plugin. It clones Git-backed
markets, exposes installed skills to DSH, and registers authorized Codex hooks.
Treat the running DSH process and the browser UI as the integration target; this
repository is not a standalone web application.

## Repository Layout

- `lib/index.js`: Host plugin. Owns market state, Git operations, skill
  registration, hooks authorization, generated hook files, hook Fibers, and
  HTTP RPC routes.
- `lib/codex-hooks.js`: Pure Host helpers for hook-source parsing, stable
  fingerprints, storage keys, and command environment injection.
- `lib/client.js`: Browser plugin. It is plain JavaScript loaded by
  `window.__ModuleLoader__`; use `require`, `React.createElement`, and no JSX,
  TypeScript, `import`, or bundler-only features.
- `cordis.patch.yml`: Adds the package to the web profile composition.
- `package.json`: DSH runtime packages are peer dependencies. The Codex hook
  bridge and protocol are direct dependencies.

## Development Rules

- Keep Host and Client responsibilities separate. Host code owns filesystem,
  Git, persistent state, hooks, and RPC. Client code owns settings-page UI and
  calls Host routes through the existing API helper.
- Preserve hook safety invariants: hooks are disabled by default, require the
  existing double-confirmation flow, are fingerprint-approved, stay within the
  plugin root, receive only the documented plugin environment variables, and
  are disposed when disabled, changed, updated, or removed.
- Treat market content and hook configuration as untrusted input. Keep path
  containment checks and do not weaken update-triggered approval revocation.
- Use `@deepseek-ai/dsh-client-ui-primitives` before making a new UI control.
  The page currently uses `Button`, `Input`, `Pill`, and `Menu`. Use
  `--dsw-*` theme tokens for any layout or missing-control adapter; never add
  fixed light/dark colors. The hooks switch is a small adapter because the
  current primitives package does not export a Switch component.
- Keep the settings section ID stable as `skills-and-hooks` unless the DSH
  settings integration is intentionally migrated. The visible label is
  `技能与 Hooks`.
- Do not start a replacement Vite server for the existing DSH GUI. Host and
  package changes need the active DSH process restarted. Client changes need a
  page refresh; claim HMR only after verifying the DSH checkout's
  `pnpm run dev:web` watcher is running.

## Validation

This project has no unit-test suite. Validate every change at the smallest
relevant level and use the real DSH GUI for end-to-end behavior.

```bash
node --check lib/index.js
node --check lib/codex-hooks.js
node --check lib/client.js
git diff --check
```

For UI, install or link the current checkout into the target DSH web profile,
restart the active DSH process when required, then test the existing GUI at
`http://127.0.0.1:3080` with `agent-browser`. Do not use curl as UI evidence.
Check the settings entry, market controls, disabled/enabled switch contrast,
and both light and dark themes after visual changes.

For hooks, use a disposable fixture and trigger a real DSH tool call. Verify
that the enabled hook receives the event, that disabling stops it, and that a
market update or configuration change revokes approval. Remove fixtures and
marker data after validation.

## Required Skill Routing

Read the named Harness skill before beginning the matching work:

- Cordis Host/Client, slots, services, or runtime plugin work: read
  `cordis-plugin-development`.
- `cordis.patch.yml`, profile composition, or preset changes: read
  `editing-cordis-compositions`.
- GUI testing or screenshots: read `agent-browser`, then run
  `agent-browser skills get core`.
- DSH package APIs, hook protocol behavior, or version contracts: read
  `contract-verification`.
- Dependency or workspace package-manager changes: read `pnpm`.
- Documentation changes: read `documentation`.
- Creating a commit: read `git-commit`.

## Git Delivery

Review `git status`, the exact diff, and staged contents before committing.
Do not commit `node_modules`, local DSH profile files, generated market data,
temporary hook fixtures, or screenshots. Use a focused Conventional Commit.
Push only when the user requests it; never force-push.
