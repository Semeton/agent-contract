# agent-contract

> A deterministic contract layer between humans and coding agents.

Most "agent guidance" today is markdown prose: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, all begging models to behave. Models skim it; it drifts from reality. **`agent-contract` replaces the begging with structure.**

One command drops a `.agent/` scaffold into your repo:

- **Stack auto-detection** — language, framework, ORM, DB, test runner, lint, formatter across 14 stacks.
- **Roles as scoped contracts** — generator, integrator, tester, debugger, documenter, security. Each role's YAML declares what it may create, modify, delete. Scopes are generated from detected framework: a Laravel init gets `app/**, config/**, routes/**`; a Rails init gets `app/**, config/**, db/**`; a NestJS init gets `src/**`. No more hardcoded `src/**` for every stack.
- **Checks as hard gates** — pre-/post-generate, debug-scope, and security-audit scripts that exit non-zero when an agent overreaches. Plug into git hooks and CI.
- **Per-stack linting/testing in checks** — `post-generate.sh` calls the right linter, typechecker, and test runner for your stack automatically.
- **Conventions enforcement** — `post-generate.sh` reads `max_lines_per_file` and `new_packages` policy directly from `conventions.yaml`. If a file exceeds the declared limit or `package.json` changes without a logged approval, the check hard-fails.
- **Claude Code hooks** — `init` writes `.claude/settings.json` with two hooks: a `PreToolUse` hook that blocks out-of-scope file writes _before_ they happen, and a `Stop` hook that auto-writes a handoff note after every turn that produces git changes. No model cooperation required.
- **Personas** — set the agent's working tone at init time: `architect`, `vibecoder`, `lead`, or `pragmatist`. Persona now affects check behaviour, not just guidance text: `architect` hard-fails when >3 files change with no decision logged; `vibecoder` skips the coverage gate entirely.
- **Convention presets** — start from `oop-strict`, `functional-pragmatic`, `nestjs-clean-architecture`, or `laravel-service-pattern`.
- **Orchestrator** — `agent-contract run` dispatches a role against a task via Anthropic, OpenAI, the `claude` CLI (for Claude Pro/Max users), or a dry-run echo provider.
- **Codebase memory map** — on every `init` and `update`, scans the repo and writes `.agent/memory/codebase-map.md`: a structured index of your directory tree, entry points, key config files, and top-level dependencies. Agents consult the map before reading source files, saving tokens on every session.
- **Session handoff protocol** — the contract shim instructs agents to write a handoff note at task completion and load the most recent one at session start. Context is never silently lost across sessions.
- **Token management** — tracks context window usage per run. Warns at 70%, writes a handoff note at 85% and on every successful task completion.
- **Decision log instead of chat history** — `memory/decisions.jsonl` carries context across models, sessions, and tools.
- **Self-updating** — `agent-contract update` checks npm for a newer version first. If one exists, it installs it globally and re-execs with the new templates automatically.
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

Refresh roles, checks, templates, stack detection, and the codebase map — leave `conventions.yaml` and `manifest.yaml` untouched:

```bash
# Check for a newer version of agent-contract, install it, then update the project
agent-contract update

# Re-apply a different persona to role YAMLs
agent-contract update --persona vibecoder

# Preview what would change (skips the version check)
agent-contract update --dry-run

# Skip the npm version check (useful in CI or offline environments)
agent-contract update --skip-self-update
```

**Self-update flow:** when a newer version is published to npm, `agent-contract update` installs it globally and re-runs the update command with the new binary — so you always get the latest templates, checks, and shim content without a separate upgrade step.

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

## Session continuity

One of the core problems with AI agents is that context is lost between sessions — decisions get forgotten, files get re-read, work gets repeated.

`agent-contract` addresses this at three levels:

### 1. Boot sequence (always enforced)

Every shim file (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`) now contains a mandatory boot sequence the agent must run at the start of every session:

1. Check `.agent/memory/` for any `handoff-*.md` files. Read the most recent one before proceeding.
2. Read `.agent/manifest.yaml` to load the full contract.
3. Read `.agent/memory/codebase-map.md` — use this as the index. Do not read raw source files before consulting the map.
4. Load the relevant role from `.agent/roles/<role>.yaml`.
5. Run `.agent/checks/pre-generate.sh` before generating any code.
6. Write your active role name (e.g. `generator`) to `.agent/session/active-role.txt`. This enables the scope-enforcement hook.

The contract is declared **non-optional** — it applies to every session, every task, every model, without needing to be mentioned in the prompt.

### 2. Codebase map

On every `init` and `update`, `agent-contract` scans the repo and writes `.agent/memory/codebase-map.md`:

```markdown
# Codebase Map
Type: existing
Language: typescript
Framework: nestjs

## Directory Structure
src/
  modules/
    users/
    orders/
  common/
tests/

## Entry Points
- src/main.ts

## Key Config Files
- package.json
- tsconfig.json

## Top-Level Dependencies
@nestjs/core, @nestjs/typeorm, pg, redis

## Agent Usage Protocol
1. Read this file BEFORE reading individual source files.
2. Use the directory structure above to decide which files to read.
...
```

For greenfield projects (fewer than 5 source files), the map notes it's a new codebase and instructs the agent to architect from scratch.

`pre-generate.sh` also warns when `codebase-map.md` predates the last git commit — a signal that the map is stale and `agent-contract update` should be run before generating code.

### 3. Handoff notes

A handoff note is written:

- **Automatically by the Stop hook** — the Claude Code `Stop` hook runs `write-handoff.sh` after every agent turn that produces git changes. The note is saved to `.agent/memory/handoff-done-{timestamp}.md` with the active role, changed files, and last 5 decisions. No model cooperation required; turns with no changes are silently skipped.
- **At task completion** — after every successful `agent-contract run`, a note is saved with the role, task, token stats, and last 5 decisions.
- **At 85% context window** — a banner is shown and a second note is saved if context is running low.
- **By the agent directly** — the shim instructs agents (Claude Code, Cursor, etc.) to fill in `.agent/templates/handoff.md` and write it to `.agent/memory/` when a task is done, then tell you to start a fresh session.

The boot sequence picks up the most recent handoff automatically, so the next session starts with full context.

## Token management

Every `agent-contract run` tracks context window usage and acts before you hit the limit.

| Threshold | Behaviour |
|---|---|
| **80%** (pre-flight) | Warns before calling the model if the prompt alone is already large |
| **70%** (post-call) | Prints a soft warning in the run output |
| **85%** (post-call) | Writes a threshold handoff note and prints a banner |
| **Task completion** | Always writes a completion handoff note regardless of token count |

When the 85% threshold is crossed:

```
╔══════════════════════════════════════════════════════════╗
║  CONTEXT WINDOW AT 87% — HANDOFF GENERATED              ║
╠══════════════════════════════════════════════════════════╣
║  Saved: .agent/memory/handoff-1747392000000.md          ║
║                                                          ║
║  Start a fresh session and open that file for context.  ║
╚══════════════════════════════════════════════════════════╝
```

The handoff note contains the current role, task, token stats, the last 5 entries from `decisions.jsonl`, and a ready-to-paste prompt for the new session.

**Known context window limits:**

| Model | Limit |
|---|---|
| claude-opus-4-8 / claude-sonnet-4-6 / claude-haiku-4-5 | 200,000 |
| gpt-4o / gpt-4o-mini / gpt-4-turbo | 128,000 |
| gpt-3.5-turbo | 16,000 |
| claude-code (CLI, estimated) | 200,000 |

For providers that don't return exact token counts (claude-code CLI), usage is estimated at 1 token per 4 characters.

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
│   ├── manifest.yaml             ← single entrypoint (persona, stack refs, enforcement policy)
│   ├── stack.yaml                ← auto-generated; language/framework facts + shell commands
│   ├── conventions.yaml          ← engineering rules (paradigm, tone, module size, DB policy…)
│   ├── config.yaml               ← provider/model config (provider, model; env vars override)
│   ├── roles/                    ← one YAML per role
│   │   ├── generator.yaml
│   │   ├── integrator.yaml
│   │   ├── tester.yaml
│   │   ├── debugger.yaml
│   │   ├── documenter.yaml
│   │   └── security.yaml
│   ├── checks/                   ← executable gates (stack-aware)
│   │   ├── pre-generate.sh       ← validates task spec before generation
│   │   ├── post-generate.sh      ← lint, typecheck, tests, role scope check
│   │   ├── debug-scope.sh        ← enforces fix-not-refactor
│   │   ├── security-audit.sh     ← credentials, insecure patterns, vulnerable deps
│   │   ├── scope-check.sh        ← PreToolUse hook: blocks out-of-scope writes
│   │   └── write-handoff.sh      ← Stop hook: auto-writes handoff on git changes
│   ├── templates/
│   │   ├── commit.txt
│   │   ├── pr.md
│   │   ├── debug-report.md
│   │   └── handoff.md            ← fill-in template agents complete at task end
│   ├── memory/
│   │   ├── decisions.jsonl                    ← append-only decision log
│   │   ├── codebase-map.md                    ← auto-generated repo index (refreshed on update)
│   │   └── handoff-done-{timestamp}.md        ← written after every completed task
│   └── session/
│       ├── .gitignore                         ← excludes session state from git
│       └── active-role.txt                    ← written at boot; read by scope-check.sh
├── .claude/
│   └── settings.json                          ← Claude Code hooks (PreToolUse + Stop)
├── CLAUDE.md                                  ← shim with boot sequence → manifest
├── AGENTS.md                                  ← shim with boot sequence → manifest
├── .cursorrules                               ← shim with boot sequence → manifest
└── .github/copilot-instructions.md           ← shim with boot sequence → manifest
```

## Design

Three properties, in order:

1. **Discoverable** — any agent walking into the repo finds it without being told.
2. **Declarative** — describes constraints, not procedures.
3. **Verifiable** — every agent output is checkable against the contract before it lands.

### Enforcement model

Defaults to **hard-fail**: scope violations exit non-zero. Enforcement runs at three layers:

| Layer | When | Mechanism |
|---|---|---|
| **PreToolUse hook** | Before each file write | `scope-check.sh` is **fail-closed**: if no role is declared in `.agent/session/active-role.txt`, all source writes are blocked. With a role declared, it parses `may_create`/`may_modify` from the role YAML and exits non-zero to block out-of-scope writes. `.agent/**` is always writable so the model can bootstrap itself. |
| **post-generate check** | After generation | `post-generate.sh` re-runs the role scope check against `git diff`, enforces `max_lines_per_file` and `new_packages` policy from `conventions.yaml`, applies persona gates (see below), then runs lint, typecheck, tests, and the coverage gate. |
| **CI / git hook** | On commit / push | Wire `post-generate.sh` and `security-audit.sh` as a pre-commit hook or CI step. Hard gate before code lands. |

`post-generate.sh` is stack-aware — it reads `stack.yaml` and runs the right linter, typechecker, and test runner for your project automatically. For example, a TypeScript/Jest project gets:

```bash
npx eslint <changed .ts files>
npx tsc --noEmit
npx jest --findRelatedTests <changed files>
```

### Conventions enforcement

`post-generate.sh` makes `conventions.yaml` load-bearing — not just documentation:

| Convention key | Enforcement |
|---|---|
| `module_size.max_lines_per_file` | Hard-fails if any changed file under `src/` exceeds the declared limit. Default 300 if key is absent. |
| `dependencies.new_packages: requires_human_approval` | Hard-fails if `package.json` is in the diff and no `approv` entry exists in the last 10 lines of `decisions.jsonl`. |
| `testing.min_coverage` | Runs the test suite with coverage (`jest --coverage`, `pytest --cov`, `go test -cover`, `phpunit --coverage-text`, JaCoCo CSV) and hard-fails if statement coverage is below the declared threshold. Skipped for `vibecoder` persona. |

### Persona gates in checks

Personas now affect check behaviour in addition to guidance text:

| Persona | Additional check gate |
|---|---|
| `architect` | Hard-fails when >3 files changed and the last line of `decisions.jsonl` has no `"task"` key — forces a logged decision before large changes land. |
| `vibecoder` | Coverage gate is skipped entirely. |
| `lead` / `pragmatist` | No additional gates beyond the defaults. |

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

### Security role

The security role is a read-only auditor — it never modifies source, only emits findings. `security-audit.sh` hard-fails on:

| Gate | What it checks |
|---|---|
| **Exposed credentials** | `password=`, `api_key=`, `token=`, `secret=`, AWS keys, PEM private key headers in changed files |
| **.env committed to git** | Any `.env` file tracked by the repository |
| **Insecure patterns** | `eval()`, `innerHTML`, `dangerouslySetInnerHTML`, `shell=True`, `os.system()`, `MD5()`, `Math.random()` in source files |
| **Vulnerable dependencies** | `npm audit` (critical + high) for Node projects; `safety check` for Python projects |

Persona guidance is applied here too — `architect` classifies findings by OWASP category; `lead` explains each finding in plain English with a remediation step; `vibecoder` flags blockers only.

## Idempotency

Re-running `init` is safe:

- Existing contract files are skipped.
- `stack.yaml` and `codebase-map.md` are always refreshed (they reflect current reality).
- Shim files (`CLAUDE.md`, `AGENTS.md`, etc.) preserve user content; the contract shim is appended once, marked with HTML comments to prevent duplication.
- `.claude/settings.json` hooks are merged in — existing hook entries are preserved and the agent-contract hooks are added only if absent.

For picking up new templates or stack-aware checks from a newer version without overwriting your conventions, use `agent-contract update` — it self-updates the tool first, then refreshes the project.

## Programmatic API

```js
const { detectStack, init, update, run } = require('@semeton/agent-contract');

// Stack detection
const stack = await detectStack(process.cwd());
console.log(stack.language, stack.framework, stack.confidence);
// stack.commands has ready-to-run lint/typecheck/test commands

// Install contract (generates codebase map + handoff template)
await init({ cwd: process.cwd(), flags: { dryRun: true } });

// Selective refresh (always refreshes stack.yaml + codebase-map.md)
await update({ cwd: process.cwd(), flags: { persona: 'architect' } });

// Run a role (writes completion handoff on success)
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
