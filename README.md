# agent-contract

> Guardrails and a merge gate for coding agents.

Agents write code fast. Two things still need a human-grade answer: **what was the agent allowed to touch**, and **why did a risky change happen**. agent-contract answers both with deterministic checks — shell scripts and a CLI that exit non-zero — instead of prose that asks the model to behave.

It works at two points:

- **At merge time, for any agent.** `agent-contract check` runs in CI on the pull request's diff. A change that touches a sensitive path — a dependency manifest, CI workflows, the contract's own scopes — must carry a recorded decision, or the check fails. It reads the diff, not the agent, so it works the same for Claude Code, Codex, Copilot, Cursor or a human.
- **During a Claude Code session.** `PreToolUse` hooks scope every file write to a role and refuse writes to the contract itself. Other agents get the same rules as written guidance (`AGENTS.md`, `.cursorrules`, Copilot instructions) — read, not enforced.

## What it looks like

Real output from a NestJS repo after `agent-contract init`, with no role declared:

```
$ edit src/payroll/new-report.ts      # new source needs a spec
scope-check: BLOCKED reason=spec-required roles=generator fix="pre-generate.sh <spec> <role>"

$ edit src/payroll/invoice.ts         # existing source: role inferred
scope-check: role inferred=integrator path=src/payroll/invoice.ts basis=may_modify

$ edit test/invoice.spec.ts           # integrator does not own tests
scope-check: BLOCKED reason=out-of-scope role=integrator path=test/invoice.spec.ts allowed=src/**

$ edit package.json                   # no role owns the dependency manifest
scope-check: BLOCKED reason=out-of-scope role=integrator path=package.json allowed=src/**

$ edit src/../.agent/roles/integrator.yaml
scope-check: BLOCKED reason=contract-controlled path=.agent/roles/integrator.yaml fix=out-of-band
```

And in CI, on a branch that adds a dependency without saying why:

```
$ agent-contract check --base origin/main
agent-contract check  origin/main...HEAD  (2 files changed)
  sensitive paths changed:
    package.json
  decisions: MISSING — these changes need a recorded reason. Either:
    • commit docs/decisions/NNNN-<title>.md with the change, or
    • add a '## Decision' section to the PR description.
```

Role scopes are per *area* (source, tests, docs), derived from your framework's layout — not per task. A role that may edit `src/**` may edit all of it.

## Install

```bash
npm i -g @semeton/agent-contract
agent-contract init        # detect stack, write .agent/, install Claude Code hooks
git add -A && git commit -m "add agent contract"
```

Commit the contract before handing work to an agent: the outcome checks compare the working tree to `HEAD`, so uncommitted `init` output would count as the agent's change. `init` is idempotent and never rewrites existing roles or your conventions. **Zero runtime dependencies.**

## The merge gate

Add one step to CI:

```yaml
# .github/workflows/agent-contract.yml
on: pull_request
jobs:
  decisions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npx -y @semeton/agent-contract check
```

In GitHub Actions it compares `origin/$GITHUB_BASE_REF...HEAD` and reads the PR description from the event payload. Elsewhere pass `--base <ref>` and `--pr-body <file>`.

A decision counts when the change **adds or edits** `docs/decisions/*.md`, or the PR description has a `## Decision` section with text under it. Deleting a decision file records nothing.

Sensitive by default: dependency manifests (`package.json`, `composer.json`, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`, `build.gradle`, `pubspec.yaml`, `*.csproj`), `.agent/roles/**`, `.agent/checks/**`, `.agent/conventions.yaml`, `.github/workflows/**` and `.claude/settings.json`. Replace the list in `.agent/config.yaml`:

```yaml
decisions_required_for: package.json, db/migrations/**, src/billing/**
decisions_dir: docs/decisions
```

Decisions live where your team already reviews them — in git, next to the change — rather than in a log the agent may or may not write.

## In-session enforcement (Claude Code)

| Gate | What it does |
|---|---|
| **Scope** | A `PreToolUse` hook checks every Write/Edit against the active role's globs. With no role declared it infers one when exactly one role covers the file, and blocks otherwise. Paths are checked as written and as resolved on disk, so `..` and symlinks don't get around it. |
| **Spec** | Creating new source means declaring `generator` through `pre-generate.sh <spec.json>`, which requires `feature_name`, `input_shape`, `output_shape`, `error_cases`. The debugger is declared the same way with its diagnosis. |
| **Contract files** | `.agent/roles/**`, `.agent/checks/**`, `.agent/session/active-role.txt` and `.claude/settings*` are refused in-session. A second hook catches common Bash writes to them. |
| **Outcome** | `post-generate.sh` re-checks the working tree against the role, then runs your stack's linter, type-checker and tests. |

**What this does not do.** The Bash guard matches command text, so `node -e`, `sed -i.bak` and similar get past it — it is a speed bump, not a sandbox. For OS-level enforcement turn on Claude Code's sandbox and add native deny rules; they cover every subprocess:

```json
{
  "permissions": { "deny": ["Edit(/.agent/roles/**)", "Edit(/.agent/checks/**)", "Edit(/package.json)"] },
  "sandbox": { "enabled": true, "allowUnsandboxedCommands": false }
}
```

The agent also chooses its own role by running `pre-generate.sh`, and writes its own spec. Roles narrow what a session touches by area; they don't stop a determined agent from switching. The merge gate is the check that does not depend on the agent at all.

## What you get

```
your-repo/
├── .agent/
│   ├── manifest.yaml        ← single entrypoint
│   ├── stack.yaml           ← auto-detected: language, framework, ORM, DB, test runner
│   ├── conventions.yaml     ← your engineering rules
│   ├── config.yaml          ← provider, effort, decision-gate paths
│   ├── roles/*.yaml         ← per-role scope (generator, integrator, tester, reviewer,
│   │                          debugger, documenter, security)
│   ├── checks/*.sh          ← pre/post-generate, scope, debug-scope, security, review
│   ├── templates/*.md       ← commit, PR, debug-report, handoff
│   ├── memory/              ← codebase-map.md, handoff notes
│   └── session/             ← active-role.txt; git-ignored
├── .claude/settings.json    ← Claude Code hooks
└── CLAUDE.md  AGENTS.md  .cursorrules  .github/copilot-instructions.md
```

## Supported stacks (auto-detection)

| Language | Frameworks | DBs / ORMs |
|---|---|---|
| TypeScript / JavaScript | NestJS, Next.js, Express, Fastify, Koa, Hono, Remix, SvelteKit, Nuxt, Vite | Prisma, TypeORM, Sequelize, Mongoose, Drizzle, Knex |
| PHP | Laravel, Symfony, Slim, CakePHP, Yii | Eloquent, Doctrine |
| Python | Django, Flask, FastAPI, Starlette, Tornado | SQLAlchemy, Django ORM, Tortoise |
| Go | Gin, Echo, Fiber, Chi | GORM, Bun |
| Rust | Axum, Actix-web, Rocket | SQLx, Diesel |
| Java / Kotlin | Spring Boot, Quarkus, Micronaut | Hibernate / Spring Data JPA |
| Ruby | Rails, Sinatra | ActiveRecord |
| C# (.NET) | ASP.NET Core | Entity Framework |
| Elixir | Phoenix, Plug, Absinthe, Nerves | Ecto, Postgrex, MyXQL |
| Scala | Akka, Play, http4s, ZIO | — |
| Clojure | Compojure, Ring, Pedestal, Reitit | — |
| Swift | Vapor, Hummingbird, SwiftNIO | Fluent |
| Dart / Flutter | Flutter | sqflite, drift, postgres |
| Deno | Fresh, Oak, Hono | — |

When a repo's layout drifts from its framework's defaults (a `src/` directory in Next.js, monorepo modules, stack-less repos), role scopes are widened to where the source actually is.

## Contributing

Adding a language is one file in `lib/detect/detectors/` that returns evidence and a score — the highest score wins. Zero deps, no build step; `npm test` gates every publish. PRs welcome.

## Learn more

The [full reference](docs/reference.md) covers every command and flag, the enforcement model in depth, personas and presets, and the programmatic API.

## License

MIT
