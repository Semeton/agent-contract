# agent-contract

> A deterministic contract layer between humans and coding agents.

`CLAUDE.md`, `AGENTS.md`, `.cursorrules` — today's "agent guidance" is prose that *asks* models to behave. They skim it, it drifts from the code, and nothing stops an agent from editing what it shouldn't.

**agent-contract replaces the asking with enforcement.** One command drops a `.agent/` contract into any repo. Each task gets a scope, and every out-of-scope write is blocked by a shell check that exits non-zero — *before* it touches your code. Any agent, any model.

```
# after init, you just write the prompt — the contract does the rest
❯ fix the null check in payroll invoicing

contract ▸ active · role: integrator (inferred) · scope: src/payroll/**

agent ▸ Edit  src/payroll/invoice.ts          ✓ allowed
agent ▸ Edit  src/payroll/invoice.test.ts     ✓ allowed
agent ▸ Edit  src/auth/session.ts             ✗ BLOCKED
  scope-check: src/auth/session.ts is outside role 'integrator'
  scope (src/payroll/**).  exit 2

✓ 1 fix shipped. 0 files touched outside scope.
```

The premise: you can't make a non-deterministic agent deterministic. You *can* make the **system around it** deterministic, so non-determinism is contained to small, verifiable units.

## Install

```bash
npm i -g @semeton/agent-contract   # CLI on your PATH; updates are one `npm i -g` away
agent-contract init                # detect stack, write contract, install hooks
```

Prefer no global install? `npx @semeton/agent-contract init` does it in one shot. `init` is idempotent — re-run any time; your conventions and shims are never clobbered. **Zero runtime dependencies**, pure Node stdlib.

## How it works

Five gates sit between a prompt and your codebase. Four of them are shell scripts that exit non-zero on a violation — the orchestrator reads exit codes, not promises.

| # | Gate | What it does |
|---|---|---|
| 1 | **Orient** | An always-on shim states the enforced rules and points at the contract — `manifest.yaml`, codebase map, conventions, prior handoffs. No mandated reading order; the agent reads what the task needs. |
| 2 | **Declare scope** | `pre-generate.sh` validates the task has what it needs, then records the active role — which arms the enforcement hook. |
| 3 | **Enforce live** | A `PreToolUse` hook checks every Write/Edit against the role's allowed paths. Out-of-scope writes are blocked before they land. |
| 4 | **Verify** | `post-generate.sh` runs the right linter, type-checker and tests for your stack, plus your `conventions.yaml` gates. |
| 5 | **Hand off** | A `Stop` hook writes a handoff note on any turn with changes, so the next session boots with context instead of starting over. |

**Fail-closed by design.** No role declared → all source writes blocked. The agent can't widen its own scope either: `.agent/roles/**`, `.agent/checks/**`, `.agent/session/active-role.txt` and `.claude/settings*` are off-limits in-session and changed only out-of-band. See the [enforcement model](docs/reference.md#enforcement-model) for the full four-layer breakdown.

## What you get

```
your-repo/
├── .agent/
│   ├── manifest.yaml        ← single entrypoint (persona, stack refs, policy)
│   ├── stack.yaml           ← auto-detected: language, framework, ORM, DB, test runner
│   ├── conventions.yaml     ← your engineering rules (the only file you hand-tune)
│   ├── roles/*.yaml         ← per-role scope (generator, integrator, tester, reviewer,
│   │                          debugger, documenter, security) — regenerated from stack
│   ├── checks/*.sh          ← the hard gates (pre/post-generate, scope, debug, security)
│   ├── templates/*.md       ← commit, PR, debug-report, handoff
│   ├── memory/              ← codebase-map.md + decisions.jsonl + handoff notes
│   └── session/             ← active-role.txt (read by the scope hook); git-ignored
├── .claude/settings.json    ← Claude Code hooks (PreToolUse scope check + Stop handoff)
├── CLAUDE.md  AGENTS.md  .cursorrules  .github/copilot-instructions.md
                             ← shims pointing every major agent at the same manifest
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

## Contributing

**Adding a language is one file.** Each stack is a single detector in `lib/detect/detectors/` that returns evidence and a score — the highest score wins:

```js
// lib/detect/detectors/elixir.js
module.exports = {
  async detect(ctx) {
    const mix = await ctx.read("mix.exs");
    if (!mix) return null;
    return {
      language: "elixir",
      framework: mix.includes(":phoenix") ? "phoenix" : "none",
      orm: "ecto",
      score: 90,
    };
  },
};
```

Zero deps to learn, pure stdlib, no build step. One smoke test (`npm test`) gates every publish. Other good first issues: a read-back YAML parser, `--learn` auto-merge, and a true orchestrator feedback loop. PRs welcome.

## Learn more

The [full reference](docs/reference.md) covers everything in depth:

- [Commands](docs/reference.md#usage) — `init`, `update`, `detect`, `run` with every flag
- [Enforcement model](docs/reference.md#enforcement-model) — the four layers, contract-controlled files, what's guaranteed vs. best-effort
- [Session continuity](docs/reference.md#session-continuity) — the always-on shim, codebase map, handoff notes
- [Personas & presets](docs/reference.md#personas) — `architect`/`vibecoder`/`lead`/`pragmatist` and convention starting points
- [Token management](docs/reference.md#token-management), [conventions enforcement](docs/reference.md#conventions-enforcement), and the [programmatic API](docs/reference.md#programmatic-api)

## License

MIT
