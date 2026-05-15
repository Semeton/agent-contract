# agent-contract

> A deterministic contract layer between humans and coding agents.

Most "agent guidance" today is markdown prose: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, all begging models to behave. Models skim it; it drifts from reality. **`agent-contract` replaces the begging with structure.**

One command drops a `.agent/` scaffold into your repo:

- **Stack auto-detection** — language, framework, ORM, DB, test runner, lint, formatter (Node, PHP, Python, Go, Rust, Java, Ruby, .NET).
- **Roles as scoped contracts** — generator, integrator, tester, debugger, documenter. Each role's YAML declares what it may create, modify, delete.
- **Checks as hard gates** — pre-/post-generate and debug-scope scripts that exit non-zero when an agent overreaches. Plug into git hooks and CI.
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

```bash
# Read-only stack detection (no writes)
agent-contract detect

# Install the contract into the current repo (idempotent)
agent-contract init

# Preview what init would do
agent-contract init --dry-run

# Refresh contract files (overwrites existing)
agent-contract init --force

# Run against a different directory
agent-contract init --cwd ../other-repo
```

## What it produces

```
your-repo/
├── .agent/
│   ├── manifest.yaml         ← single entrypoint
│   ├── stack.yaml            ← auto-generated; language/framework facts
│   ├── conventions.yaml      ← engineering rules (OOP, ACID, module size, etc.)
│   ├── roles/                ← one YAML per role
│   │   ├── generator.yaml
│   │   ├── integrator.yaml
│   │   ├── tester.yaml
│   │   ├── debugger.yaml
│   │   └── documenter.yaml
│   ├── checks/               ← executable gates
│   │   ├── pre-generate.sh
│   │   ├── post-generate.sh
│   │   └── debug-scope.sh
│   ├── templates/
│   │   ├── commit.txt
│   │   ├── pr.md
│   │   └── debug-report.md
│   └── memory/
│       └── decisions.jsonl
├── CLAUDE.md                  ← shim → manifest
├── AGENTS.md                  ← shim → manifest
├── .cursorrules               ← shim → manifest
└── .github/copilot-instructions.md   ← shim → manifest
```

## Design

Three properties, in order:

1. **Discoverable** — any agent walking into the repo finds it without being told.
2. **Declarative** — describes constraints, not procedures.
3. **Verifiable** — every agent output is checkable against the contract before it lands.

### Enforcement model

Defaults to **hard-fail**: scope violations exit non-zero. Checks live in both the pre/post hooks (fast feedback for agents) and CI (hard gate for humans).

### Debugger workflow (illustrative)

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

## Programmatic API

```js
const { detectStack, init } = require('@semeton/agent-contract');

const stack = await detectStack(process.cwd());
console.log(stack.language, stack.framework, stack.confidence);

await init({ cwd: process.cwd(), flags: { dryRun: true } });
```

## Supported stacks (auto-detection)

| Language    | Frameworks                                     | DBs / ORMs                          |
|-------------|------------------------------------------------|-------------------------------------|
| TypeScript / JavaScript | NestJS, Next.js, Express, Fastify, Koa, Hono, Remix, SvelteKit, Nuxt, Vite | Prisma, TypeORM, Sequelize, Mongoose, Drizzle, Knex |
| PHP         | Laravel, Symfony, Slim, CakePHP, Yii          | Eloquent (Laravel), Doctrine        |
| Python      | Django, Flask, FastAPI, Starlette, Tornado    | SQLAlchemy, Django ORM, Tortoise    |
| Go          | Gin, Echo, Fiber, Chi                          | GORM, Bun                            |
| Rust        | Axum, Actix-web, Rocket                        | SQLx, Diesel                         |
| Java/Kotlin | Spring Boot, Quarkus, Micronaut                | Hibernate / Spring Data JPA          |
| Ruby        | Rails, Sinatra                                 | ActiveRecord                         |
| C# (.NET)   | ASP.NET Core                                   | Entity Framework                     |

Adding a new stack = adding one detector file in `lib/detect/detectors/`.

## License

MIT
