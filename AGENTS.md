# AGENTS.md

## Scope

`dsh-agent-plugin-market` is a dual-face DSH plugin. It clones Git-backed
markets, exposes enabled skills to DSH, and registers authorized Codex hooks.
Treat the running DSH process and the browser UI as the integration target; this
repository is not a standalone web application.

## Repository Layout

- `lib/index.js`: Host composition root. Wires injected DSH services to the
  market runtime, market service, hook manager, skills provider, startup update,
  model tools, and loopback RPC routes.
- `lib/market-runtime.js`: Host runtime for DSH-home paths, configuration I/O,
  Git command execution, market/plugin manifest parsing, and skill scanning.
- `lib/market-service.js`: Host lifecycle service for market Git operations,
  plugin installation, skill state, hooks authorization, state views, and
  startup auto-update.
- `lib/market-tools.js`: Host model tools for market state reads and workspace
  plugin/skill override writes, with scoped restriction for home-path agents.
- `lib/market-config.js`: Pure configuration state transitions for markets,
  installed plugins, skill switches, and related cleanup.
- `lib/codex-hook-manager.js`: Codex hook inspection, approval reconciliation,
  generated bridge configuration, and hook Fiber lifecycle management.
- `lib/hook-reconcile-plan.js`: Pure desired-versus-active hook reconciliation
  plan.
- `lib/codex-hooks.js`: Pure helpers for hook-source parsing, path validation,
  stable fingerprints and storage keys, plus command-environment injection.
- `lib/client.js`: Browser plugin. It is plain JavaScript loaded by
  `window.__ModuleLoader__`; split catalog models, shared controls, settings
  section, and workspace dialog into internal functions/sections in this file;
  use `require`, `React.createElement`, and no JSX, TypeScript, `import`, or
  bundler-only features.
- `cordis.patch.yml`: Adds the package to the web profile composition.
- `package.json`: `@deepseek-ai/dsh-client-ui-primitives` is a required peer
  dependency. `@deepseek-ai/dsh-hooks-codex` is an optional peer; when absent,
  the UI provides the runtime install command for it and
  `@deepseek-ai/dsh-hook-protocol`.

## Development Rules

- Keep Host and Client responsibilities separate. Host code owns filesystem,
  Git, persistent state, hooks, and RPC. Client code owns settings-page UI and
  calls Host routes through the existing API helper.
- Preserve hook safety invariants: hooks are disabled by default, the UI uses
  double confirmation, approvals match the configuration fingerprint, hook
  configuration file paths remain inside the plugin root, and command hooks
  receive only `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, and
  `CLAUDE_PLUGIN_DATA`. Dispose hook Fibers when hooks are disabled, changed,
  updated, or removed.
- Treat market content and hook configuration as untrusted input. Keep path
  containment checks. Bind approvals to verified hook configuration
  fingerprints, not market pull outcomes. Market pulls suspend hook Fibers while
  Git mutates the checkout; reconciliation remounts matching approved
  fingerprints, disposes mismatches, and clears approvals when the current hook
  configuration disappears or becomes unusable.
- Use `@deepseek-ai/dsh-client-ui-primitives` before making a new UI control.
  The page uses `Button`, `Input`, `Pill`, `Menu`, `Tooltip`, and
  `DisclosureRow`. Use `--dsw-*` theme tokens for layout or any missing-control
  adapter; never add fixed light/dark colors. The hooks switch is a small native
  button adapter.
- Keep the settings section ID stable as `skills-and-hooks` unless the DSH
  settings integration is intentionally migrated. The visible label is
  `技能与挂钩`.
- Treat `lib/`, `package.json`, `cordis.patch.yml`, and applicable tests as the
  source of truth for repository behavior. When behavior changes, update every
  tracked Markdown document that describes it; do not describe Codex bridge
  event support beyond the verified installed bridge/protocol contract.
- Use exclusive local debugging: link the Web profile to this repository root
  and develop here. Do not use a separate Git worktree for debugging; switching
  branches in the root checkout is allowed when needed.
- Do not start a replacement Vite server for the existing DSH GUI. Client
  changes need a page refresh unless the DSH checkout's `pnpm run dev:web`
  watcher is running; claim HMR only after verifying that watcher.
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
use curl as UI evidence. Check the settings entry, market controls,
disabled/enabled switch contrast, and both light and dark themes after visual
changes.

The Node suite covers configuration, runtime scanning, hook helpers,
reconciliation planning, and catalog-model behavior. For manual hook E2E
verification, create a disposable local Git market fixture under ignored
`test-repos/`, trigger a real DSH tool call, verify enabled delivery and disable
disposal, then update the market to check that unchanged approved fingerprints
remount and changed hook configurations require reapproval. Remove the
registered market and marker data after validation.

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
