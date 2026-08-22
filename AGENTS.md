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
  bridge and protocol are optional peers so markets and skills work without them.

## Development Rules

- Keep Host and Client responsibilities separate. Host code owns filesystem,
  Git, persistent state, hooks, and RPC. Client code owns settings-page UI and
  calls Host routes through the existing API helper.
- Preserve hook safety invariants: hooks are disabled by default, require the
  existing double-confirmation flow, are fingerprint-approved, stay within the
  plugin root, receive only the documented plugin environment variables, and
  are disposed when disabled, changed, updated, or removed.
- Treat market content and hook configuration as untrusted input. Keep path
  containment checks. On a market update, only hooks actively mounted before
  the pull may be re-enabled against the new configuration; all other hook
  approvals remain revoked.
- Use `@deepseek-ai/dsh-client-ui-primitives` before making a new UI control.
  The page currently uses `Button`, `Input`, `Pill`, and `Menu`. Use
  `--dsw-*` theme tokens for any layout or missing-control adapter; never add
  fixed light/dark colors. The hooks switch is a small adapter because the
  current primitives package does not export a Switch component.
- Keep the settings section ID stable as `skills-and-hooks` unless the DSH
  settings integration is intentionally migrated. The visible label is
  `技能与 Hooks`.
- Use exclusive local debugging: link the Web profile to this repository root
  and develop here. Do not use a separate Git worktree for debugging; switching
  branches in the root checkout is allowed when needed.
- Do not start a replacement Vite server for the existing DSH GUI. Client
  changes need a page refresh; claim HMR only after verifying the DSH checkout's
  `pnpm run dev:web` watcher is running.
- Do not restart DSH autonomously. Host and package changes need a restart, so
  ask the user to restart and confirm the current state, or end the turn asking
  them to message again after restarting.

## Validation

Run the Node unit suite for core behavior before using the real DSH GUI for
end-to-end validation.

```bash
pnpm lint
pnpm test
pnpm typecheck
node --check lib/*.js test/*.test.js
git diff --check
```

For UI, link this repository root into the target DSH web profile. For Host or
package changes, ask the user to restart DSH and confirm it has restarted, then
test the existing GUI at `http://127.0.0.1:3080` with `agent-browser`. Do not
use curl as UI evidence.
Check the settings entry, market controls, disabled/enabled switch contrast,
and both light and dark themes after visual changes.

For hooks, create disposable local Git market fixtures under `test-repos/`
and trigger a real DSH tool call. Verify that the enabled hook receives the
event, disabling stops it, and a market update attempts to reactivate a hook
that was active before the pull. Remove the registered market and marker data
after validation.

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
