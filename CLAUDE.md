# agent-contract — repo context for Claude Code

This is the **source code for `agent-contract` itself** — a CLI that installs a deterministic contract layer into target repos.

Do NOT confuse this repo with a repo that *uses* `agent-contract`. There is no `.agent/` directory here because this is the tool, not a consumer of it.

## What it does

`agent-contract init` drops a `.agent/` directory into any repo, plus discoverability shims (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`). The scaffold contains:

- `manifest.yaml` — single entrypoint
- `stack.yaml` — auto-detected (language, framework, ORM, db, test runner, lint, formatter)
- `conventions.yaml` — declarative engineering policy
- `roles/` — one YAML per role (generator, integrator, tester, debugger, documenter), each with scoped permissions
- `checks/` — executable shell scripts that hard-fail on violations (pre-generate, post-generate, debug-scope)
- `templates/` — commit, PR, debug-report
- `memory/decisions.jsonl` — append-only decision log

## Architecture

```
bin/agent-contract.js       ← CLI entrypoint, no deps
lib/
  index.js                  ← programmatic API
  commands/
    init.js                 ← orchestrates detect → write plan → execute
    detect.js               ← read-only detection (json or human output)
  detect/
    index.js                ← detector pipeline + scoring
    detectors/
      node.js               ← NestJS, Next.js, Express, Fastify, ...
      php.js                ← Laravel, Symfony, ...
      python.js             ← Django, Flask, FastAPI
      go.js, rust.js, java.js, ruby.js, dotnet.js
  util/
    yaml.js                 ← minimal hand-rolled YAML emitter (no js-yaml dep)
    fs.js                   ← idempotent file writer (create-only / merge-shim / overwrite)
    templates.js            ← all emitted file contents live here
test/
  smoke.js                  ← end-to-end test, gates `npm publish` via prepublishOnly
```

**Zero runtime dependencies.** Pure Node stdlib. This is intentional — the package needs to install cleanly into any repo without dependency conflicts.

## Design principles for changes to this codebase

- **Detectors return evidence with a score.** The resolver picks the highest-scoring candidate. Adding a new language = adding one detector file in `lib/detect/detectors/` that exports `async detect(ctx)`.
- **Hard-fail enforcement.** Check scripts exit non-zero on violations. The orchestrator (future work) reads exit codes, not parses output.
- **Idempotency is non-negotiable.** Every file write goes through `lib/util/fs.js` with an explicit mode. Re-running `init` must be safe.
- **Templates are content, not procedures.** Anything emitted into a target repo lives in `lib/util/templates.js`. If you find yourself templating logic, push it back into the CLI.
- **No dependencies without strong justification.** Every dep is a supply-chain risk and a friction point for users. We hand-rolled YAML emission specifically to avoid `js-yaml`.

## Commands

```bash
npm test                    # run smoke test
node bin/agent-contract.js detect --cwd <path>
node bin/agent-contract.js init --cwd <path> [--dry-run|--force]
```

## Known gaps / future work

1. `post-generate.sh` is stack-agnostic; should call `eslint`/`phpstan`/`pytest` based on `stack.yaml`.
2. No `--learn` mode for legacy convention inference.
3. No orchestrator — role YAMLs declare the contract, nothing dispatches against them yet.
4. YAML emitter is one-way (emit only). If users start editing contract files we'll need to read them back; swap in `js-yaml` then.

## Publishing

See `PUBLISHING.md`. Scope is `@CHANGE-ME` — must be replaced before first publish.
