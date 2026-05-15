# agent-contract

> A deterministic contract layer between humans and coding agents.

Most "agent guidance" today is markdown prose: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, all begging models to behave. Models skim it; it drifts from reality. **`agent-contract` replaces the begging with structure.**

One command drops a `.agent/` scaffold into your repo:

- **Stack auto-detection** — language, framework, ORM, DB, test runner, lint, formatter across 14 stacks.
- **Roles as scoped contracts** — generator, integrator, tester, debugger, documenter. Each role's YAML declares what it may create, modify, delete.
- **Checks as hard gates** — pre-/post-generate and debug-scope scripts that exit non-zero when an agent overreaches. Plug into git hooks and CI.
- **Per-stack linting/testing in checks** — `post-generate.sh` calls the right linter, typechecker, and test runner for your stack automatically.
- **Personas** — set the agent's working tone at init time: `architect`, `vibecoder`, `lead`, or `pragmatist`.
- **Convention presets** — start from `oop-strict`, `functional-pragmatic`, `nestjs-clean-architecture`, or `laravel-service-pattern`.
- **Orchestrator** — `agent-contract run` dispatches a role against a task via Anthropic, OpenAI, the `claude` CLI (for Claude Pro/Max users), or a dry-run echo provider.
- **Decision log instead of chat history** — `memory/decisions.jsonl` carries context across models, sessions, and tools.
- **Discoverable by every major agent** — drops shim files at `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`, all pointing to the same manifest.

The premise: you can't make non-deterministic agents deterministic. You can make the **system around them** deterministic so non-determinism is contained to small, verifiable units.

## Install

Use directly via `npx` — no global install needed:

```bash
npx @semeton/agent-contract init
```

Or install once:

```bash
npm i -g @semeton/agent-contract
agent-contract init
```

## Usage

### Initialize

```bash
# Install the contract into the current repo (idempotent)
agent-contract init

# Preview what init would do
agent-contract init --dry-run

# Pick a conventions preset interactively (or pass directly)
agent-contract init --preset oop-strict

# Set the agent persona
agent-contract init --persona architect

# Both at once
agent-contract init --preset nestjs-clean-architecture --persona lead

# Accept all defaults — skip prompts (useful in CI)
agent-contract init --yes

# Sample existing source files and write a draft conventions.yaml
agent-contract init --learn

# Run against a different directory
agent-contract init --cwd ../other-repo
```

### Update

Refresh roles, checks, templates, and stack detection — leave `conventions.yaml` and `manifest.yaml` untouched:

```bash
# Refresh with the persona already in manifest.yaml
agent-contract update

# Re-apply a different persona to role YAMLs
agent-contract update --persona vibecoder

# Preview what would change
agent-contract update --dry-run
```

Use `update` instead of `--force` when you want to pick up new role templates or stack-aware checks from a newer version of `agent-contract` without overwriting your conventions.

### Detect

```bash
# Read-only stack detection (no writes)
agent-contract detect

# JSON output
agent-contract detect --json
```

### Run

Dispatch a role against a task using the configured AI provider:

```bash
# Auto-detect provider, run generator role
agent-contract run --role generator --task "add a POST /users endpoint"

# Pass a structured task spec file
agent-contract run --role debugger --spec ./task.json

# Use a specific provider
agent-contract run --role generator --task "..." --provider anthropic
agent-contract run --role generator --task "..." --provider openai
agent-contract run --role generator --task "..." --provider claude-code
agent-contract run --role generator --task "..." --provider echo
```

**Provider auto-detection order** (first available wins):
1. `anthropic` — if `ANTHROPIC_API_KEY` is set
2. `openai` — if `OPENAI_API_KEY` is set
3. `claude-code` — if the `claude` CLI is installed (Claude Pro/Max, no API key needed)
4. `echo` — prints the assembled prompt, calls nothing (dry run)

## Personas

Set at `init` or `update` time via `--persona`. Affects the `tone:` block in `conventions.yaml` and the `guidance:` arrays in your role YAMLs.

| Persona | Style | What it enforces |
|---|---|---|
| `pragmatist` | balanced | Quality without ceremony. Default. |
| `architect` | deliberate | Document every decision. Refuse vague tasks. No shortcuts under time pressure. |
| `vibecoder` | fast | Ship first, structure later. No over-engineering. No waiting for a perfect spec. |
| `lead` | mentorship | Explain the why. Write code a junior can read. Leave learnings in debug reports. |

## Convention presets

Applied at `init` time via `--preset`. Fills in `conventions.yaml` with an opinionated starting point.

| Preset | Best for |
|---|---|
| `oop-strict` | TypeScript/Java projects with strict OOP, typed exceptions, 80% coverage |
| `functional-pragmatic` | Pure functions, immutable data, no class inheritance |
| `nestjs-clean-architecture` | NestJS with modules, services, repositories, DTOs |
| `laravel-service-pattern` | Laravel with service/repository layers, FormRequests, Eloquent models |
| `none` | Blank `conventions.yaml` — fill it yourself |

## `--learn` mode

Samples up to 20 source files, infers your existing conventions, and writes a draft to `.agent/conventions.draft.yaml` for human review. Nothing is auto-applied.

```bash
agent-contract init --learn
```

Infers: paradigm (OOP vs functional), error style, file naming convention, test placement pattern.

## What it produces

```
your-repo/
├── .agent/
│   ├── manifest.yaml         ← single entrypoint (persona, stack refs, enforcement policy)
│   ├── stack.yaml            ← auto-generated; language/framework facts + shell commands
│   ├── conventions.yaml      ← engineering rules (paradigm, tone, module size, DB policy…)
│   ├── config.yaml           ← provider/model config (not committed if sensitive)
│   ├── roles/                ← one YAML per role
│   │   ├── generator.yaml
│   │   ├── integrator.yaml
│   │   ├── tester.yaml
│   │   ├── debugger.yaml
│   │   └── documenter.yaml
│   ├── checks/               ← executable gates (stack-aware)
│   │   ├── pre-generate.sh
│   │   ├── post-generate.sh
│   │   └── debug-scope.sh
│   ├── templates/
│   │   ├── commit.txt
│   │   ├── pr.md
│   │   └── debug-report.md
│   └── memory/
│       └── decisions.jsonl
├── CLAUDE.md                          ← shim → manifest
├── AGENTS.md                          ← shim → manifest
├── .cursorrules                       ← shim → manifest
└── .github/copilot-instructions.md   ← shim → manifest
```

## Design

Three properties, in order:

1. **Discoverable** — any agent walking into the repo finds it without being told.
2. **Declarative** — describes constraints, not procedures.
3. **Verifiable** — every agent output is checkable against the contract before it lands.

### Enforcement model

Defaults to **hard-fail**: scope violations exit non-zero. Checks live in both the pre/post hooks (fast feedback for agents) and CI (hard gate for humans).

`post-generate.sh` is stack-aware — it reads `stack.yaml` and runs the right linter, typechecker, and test runner for your project automatically. For example, a TypeScript/Jest project gets:

```bash
npx eslint <changed .ts files>
npx tsc --noEmit
npx jest --findRelatedTests <changed files>
```

### Debugger workflow

The debugger role enforces "fix, don't refactor" structurally:

```yaml
role: debugger
workflow:
  - reproduce
  - diagnose
  - list_affected_files
  - propose_solutions    # min: 2, max: 4
  - await_human_selection
  - implement_within_scope
scope_rule: changes_must_be_subset_of_diagnosis_files
refactor_policy: forbidden_unless_explicitly_approved
```

The agent literally cannot skip `await_human_selection` because `debug-scope.sh` exits non-zero when it does.

## Idempotency

Re-running `init` is safe:

- Existing contract files are skipped.
- `stack.yaml` is always refreshed (it should reflect current reality).
- Shim files (`CLAUDE.md`, `AGENTS.md`, etc.) preserve user content; the contract shim is appended once, marked with HTML comments to prevent duplication.

For picking up new templates or stack-aware checks from a newer version without overwriting your conventions, use `agent-contract update` instead of `--force`.

## Programmatic API

```js
const { detectStack, init, update, run } = require('@semeton/agent-contract');

// Stack detection
const stack = await detectStack(process.cwd());
console.log(stack.language, stack.framework, stack.confidence);
// stack.commands has ready-to-run lint/typecheck/test commands

// Install contract
await init({ cwd: process.cwd(), flags: { dryRun: true } });

// Selective refresh
await update({ cwd: process.cwd(), flags: { persona: 'architect' } });

// Run a role
await run({ cwd: process.cwd(), flags: { role: 'generator', task: 'add auth middleware' } });
```

## Supported stacks (auto-detection)

| Language | Frameworks | DBs / ORMs |
|---|---|---|
| TypeScript / JavaScript | NestJS, Next.js, Express, Fastify, Koa, Hono, Remix, SvelteKit, Nuxt, Vite | Prisma, TypeORM, Sequelize, Mongoose, Drizzle, Knex |
| PHP | Laravel, Symfony, Slim, CakePHP, Yii | Eloquent (Laravel), Doctrine |
| Python | Django, Flask, FastAPI, Starlette, Tornado | SQLAlchemy, Django ORM, Tortoise |
| Go | Gin, Echo, Fiber, Chi | GORM, Bun |
| Rust | Axum, Actix-web, Rocket | SQLx, Diesel |
| Java / Kotlin | Spring Boot, Quarkus, Micronaut | Hibernate / Spring Data JPA |
| Ruby | Rails, Sinatra | ActiveRecord |
| C# (.NET) | ASP.NET Core | Entity Framework |
| Elixir | Phoenix, Plug, Absinthe, Nerves | Ecto, Postgrex, MyXQL |
| Scala | Akka, Play, http4s, ZIO | — |
| Clojure | Compojure, Ring, Pedestal, Reitit | — |
| Swift | Vapor, Hummingbird, SwiftNIO | Fluent (PostgreSQL, MySQL, SQLite) |
| Dart / Flutter | Flutter | sqflite, drift, postgres |
| Deno | Fresh, Oak, Hono | — |

Adding a new stack = one detector file in `lib/detect/detectors/`.

## License

MIT
