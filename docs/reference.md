# agent-contract — full reference

> The complete reference for every command, flag, role, check, and enforcement layer.
> New here? Start with the [README](../README.md) — it gets you running in 60 seconds.

Most "agent guidance" today is markdown prose: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, all begging models to behave. Models skim it; it drifts from reality. **`agent-contract` replaces the begging with structure.**

One command drops a `.agent/` scaffold into your repo:

- **Stack auto-detection** — language, framework, ORM, DB, test runner, lint, formatter across 14 stacks.
- **Roles as scoped contracts** — generator, integrator, tester, reviewer, debugger, documenter, security. Each role's YAML declares what it may create, modify, delete. Scopes are generated from detected framework: a Laravel init gets `app/**, config/**, routes/**`; a Rails init gets `app/**, config/**, db/**`; a NestJS init gets `src/**`. No more hardcoded `src/**` for every stack. Roles are always regenerated from the detected stack on `init` and `update` — they are declarative output, not user-edited config.
- **Checks as hard gates** — pre-/post-generate, debug-scope, and security-audit scripts that exit non-zero when an agent overreaches. Plug into git hooks and CI.
- **Per-stack linting/testing in checks** — `post-generate.sh` calls the right linter, typechecker, and test runner for your stack automatically.
- **Conventions enforcement** — `post-generate.sh` reads `max_lines_per_file` and `new_packages` policy directly from `conventions.yaml`. If a file exceeds the declared limit or `package.json` changes without a logged approval, the check hard-fails.
- **Claude Code hooks** — `init` writes `.claude/settings.json` with three hooks: a `PreToolUse` hook on the file tools that blocks out-of-scope writes _before_ they happen, a `PreToolUse` hook on `Bash` that stops commands from tampering with contract-controlled files (the self-escape vector), and a `Stop` hook that auto-writes a handoff note after every turn that produces git changes. No model cooperation required.
- **Self-protecting & fail-closed** — the agent cannot rewrite its own role, widen a role's scope, or edit the guard scripts: `.agent/roles/**`, `.agent/checks/**`, `.agent/session/active-role.txt`, and `.claude/settings*` are off-limits in-session and changed only out-of-band. A role with an empty scope is read-only, not unrestricted. See [Enforcement model](#enforcement-model).
- **Personas** — set the agent's working tone at init time: `architect`, `vibecoder`, `lead`, or `pragmatist`. Persona now affects check behaviour, not just guidance text: `architect` hard-fails when >3 files change with no decision logged; `vibecoder` skips the coverage gate entirely.
- **Convention presets** — start from `oop-strict`, `functional-pragmatic`, `nestjs-clean-architecture`, or `laravel-service-pattern`.
- **Orchestrator** — `agent-contract run` dispatches a role against a task via Anthropic, OpenAI, the `claude` CLI (for Claude Pro/Max users), or a dry-run echo provider.
- **Codebase memory map** — on every `init` and `update`, scans the repo and writes `.agent/memory/codebase-map.md`: a structured index of your directory tree (with filenames at depth ≤ 2), entry points, key config files, and top-level dependencies. Agents consult the map before reading source files — they can navigate directly to the right file without scanning. Crowded directories (>20 source files) are annotated with a count instead of an exhaustive list so the map stays bounded on large projects.
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

Always refreshes: `stack.yaml`, `codebase-map.md`, all check scripts, and all role YAMLs (roles are declarative output derived from stack detection, not user-edited config).

Refreshes **in place**, preserving anything you wrote: the shim block in `CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `.github/copilot-instructions.md`, and the documentation block in `config.yaml`. Both are delimited by markers; content outside them is never rewritten, so an uncommented `provider:` or your own notes above the shim survive. A `config.yaml` written before the markers existed is regenerated only if it holds no active settings — if you have configured something, it is left alone entirely. `config.yaml` is never touched by `--force` either; losing a provider choice is worse than carrying a stale comment.

**Scope changes need consent.** Role YAMLs are generated from `lib/util/templates.js`, which
lives inside the `lib/**` glob an integrator-scoped agent may modify — so "edit the generator,
re-run `update`" was a way for a session to grant itself any scope it liked. `update` now diffs
every regenerated role against the one on disk and refuses when a role would gain a writable or
deletable glob:

```
      WIDENS role scope:
        + .agent/roles/integrator.yaml  writable: bin/**

      refusing to widen a role's scope without explicit consent.
      Review the paths above. If they are what you want, re-run with:
        agent-contract update --allow-scope-change
```

It exits 1 and writes nothing. Narrowing a scope is always allowed and never prompts. `--force`
carries the same consent, since it already means overwrite-the-contract — without that, a
corrupted role file could not be repaired (an unparseable scope reads as empty, so restoring it
looks like a widening).

Both flags are blocked inside an agent session by `bash-write-guard.sh`, so consent has to come
from a human terminal or a human-run CI step. A guard a session can wave through itself is
decoration.

**Enforcement code is guarded the same way — but only where it needs to be.** Every check
script is regenerated from the package's templates, so if those templates are editable, so are
the guards. Whether they are editable depends on where the tool lives:

| Where `lib/util/templates.js` lives | Plain `update` | Why |
|---|---|---|
| Installed package, outside the repo (normal) | ships new checks freely | Templates are upstream; no role scope reaches them. This is the self-update path. |
| Inside the repo — self-hosted or vendored | refuses without consent | An agent with `src/**`/`lib/**` scope can rewrite the guards, and plain `update` would deploy them. |

**Role inference.** Blocking every source write until `pre-generate.sh` had run cost a turn at
the start of any session not dispatched through `agent-contract run`. With no active role,
`scope-check.sh` now derives one from the target:

| Target | Resolves against | Result |
|---|---|---|
| existing `lib/x.js` | `may_modify` | infers `integrator` |
| existing `test/x.js` | `may_modify` | infers `tester` |
| existing `README.md`, `docs/**` | `may_modify` | infers `documenter` |
| **new** `lib/x.js` | `may_create` | **blocked** — `generator` declares `inputs_required` |
| new `test/x.js`, `docs/x.md` | `may_create` | infers `tester` / `documenter` |
| `package.json`, `Makefile` | either | blocked — no role covers it |

Existence is what disambiguates: editing a file is a modification, creating one is a creation,
and the two keys rarely overlap. A role declaring `inputs_required` is never inferred, so
generating new source still requires the spec gate — and `debugger`, which may modify source
and tests, is only ever declared with a filled-in diagnosis rather than inferred.

This relaxes ceremony, not enforcement. The chosen role's globs are still checked on every
write, so inference can only pick a role that would have allowed the write anyway — an inferred
`tester` still cannot write `lib/`. An explicit role is never overridden, and
contract-controlled paths are rejected before inference runs. The stderr note
(`scope-check: role inferred=integrator path=lib/a.js basis=may_modify`) keeps it visible.

**Writes outside the repo.** A repo-level contract does not police the whole filesystem, and
`scope-check.sh` still allows writes to tmp dirs, scratch space and sibling projects. Two
exceptions are enforced at any path, because they decide whether the contract runs at all:
an installed `agent-contract/lib/**` or `agent-contract/bin/**`, and `.claude/settings*.json`.
Without these, any target repo could reach the globally installed CLI, tamper with the
templates, and re-run `update`.

**Consent is checked as a terminal property, not a command string.** `update` refuses
`--allow-scope-change` and `--force` when stdin is not a TTY. Matching the command string can
never establish that a human asked — `F=--force; agent-contract update $F` defeats any regex —
so the decision is made by the program receiving the flag. An agent's Bash tool has no
controlling terminal; your shell does.

CI has no TTY either, so there is one documented hatch:

```bash
AGENT_CONTRACT_NONINTERACTIVE_CONSENT=1 agent-contract update --allow-scope-change
```

Anyone who can set that in a CI config is a human with write access to the repo. Inside an
agent session `bash-write-guard.sh` blocks the variable outright, so the obvious spelling is
still refused. Set it in test suites and scripts that drive `update` programmatically.

**Drift is detected, not just prevented.** `pre-generate.sh` hard-fails when
`.claude/settings.json` exists but no longer references `scope-check.sh` and
`bash-write-guard.sh` — unwired hooks silently turn every scope rule into a suggestion. A
missing settings.json only warns (a Cursor or Copilot repo never had them). `agent-contract
status` prints the same wiring check, plus which check scripts differ from what the installed
templates would emit and which role scopes are wider on disk than the template produces:

```
enforcement:
  hooks:      wired (scope-check, bash-write-guard, write-handoff)
  checks:     DRIFTED — pre-generate.sh, bash-write-guard.sh
              run `agent-contract update` to reconcile (out-of-band)
  roles:      no out-of-band scope grants
```

Worth being plain about the limit: an attacker who has already unwired the hooks has won. This
is here so that a human, or a CI step running `status`, notices — and so ordinary staleness
(a repo initialized against an older version) stops being invisible.

**What is still best-effort.** The `bash-write-guard.sh` regexes remain pattern matches and are
now the *secondary* layer — they catch literal forms early with a clear message, while the TTY
gate is what actually holds. `post-generate.sh`'s diff check is the backstop for any change
however it was made. `lib/util/scope.js` and the emitted `checks/scope-lib.sh` are still two
implementations of one rule, though a conformance test over adversarial YAML shapes now fails
the build if the JS copy ever sees fewer globs than the shell one.

Leaves `conventions.yaml`, `manifest.yaml`, and templates untouched — overwrite templates with `--force`:

```bash
# Check for a newer version of agent-contract, install it, then update the project
agent-contract update

# Re-apply a different persona to role YAMLs
agent-contract update --persona vibecoder

# Preview what would change (skips the version check)
agent-contract update --dry-run

# Skip the npm version check (useful in CI or offline environments)
agent-contract update --skip-self-update

# Consent to roles gaining writable paths (see "Scope changes need consent" below).
# Blocked inside an agent session — run this from your own terminal.
agent-contract update --allow-scope-change
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

# Pass a structured task spec file (must be JSON with these keys):
# { "feature_name": "...", "input_shape": "...", "output_shape": "...", "error_cases": [] }
agent-contract run --role debugger --spec ./task.json

# Use a specific provider
agent-contract run --role generator --task "..." --provider anthropic
agent-contract run --role generator --task "..." --provider openai
agent-contract run --role generator --task "..." --provider claude-code
agent-contract run --role generator --task "..." --provider echo
```

**Provider auto-detection order** (first available wins):
1. `claude-code` — if the `claude` CLI is installed (Claude Pro/Max, no API key needed)
2. `anthropic` — if `ANTHROPIC_API_KEY` is set
3. `openai` — if `OPENAI_API_KEY` is set
4. `echo` — prints the assembled prompt, calls nothing (dry run)

An explicit `--provider`, or `provider:` in `.agent/config.yaml`, overrides detection.

**Reasoning effort.** Each role declares its own `effort` — the depth the model reasons at
before answering. The Anthropic API defaults to `high`, so the cheap roles cost less than
they used to and only the two hardest-reasoning roles cost more:

| Role | Effort |
|---|---|
| `documenter` | `low` |
| `integrator`, `tester` | `medium` |
| `generator`, `reviewer` | `high` |
| `debugger`, `security` | `xhigh` |

Precedence is `AGENT_EFFORT` env var → `effort:` in `.agent/config.yaml` → the role's own
value. An unrecognised value fails the run and names both the value and where it came from.
Valid values are `low`, `medium`, `high`, `xhigh`, `max`; the setting applies to the
`anthropic` provider (the `claude-code` CLI takes its own settings, and `openai` ignores it).
`--effort <level>` overrides it for a single run.

**What the `anthropic` provider sends.** `claude-opus-5` by default, adaptive thinking, the
role's effort in `output_config`, and a cache breakpoint on the system prefix — the contract
(stack + conventions + role) is byte-identical between runs of the same role, so it caches while
the volatile task spec stays in `messages`. Requests **stream**, which is what makes a 64,000
`max_tokens` safe: thinking tokens count against that ceiling, and a non-streaming call at this
size risks an HTTP timeout before the model finishes. A safety decline arrives as HTTP 200 with
`stop_reason: "refusal"` and is reported as an error naming the category, not as empty output.

**What is deliberately not writable.** `package.json` (and its per-stack equivalents) sits in no
role's scope. It is the dependency manifest, so an agent that can edit it can add a dependency —
that stays a human review step. Version bumps go through
`npm version <level> --no-git-tag-version`, a release action rather than a task action. The
agent-facing shims (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
`.github/copilot-instructions.md`) *are* owned by the documenter role: rewriting one disables no
enforcement, since the hooks are the enforcement and the shim block is marker-delimited and
regenerated by `update`, so tampering inside it is transient and shows up in a diff.

## Session continuity

One of the core problems with AI agents is that context is lost between sessions — decisions get forgotten, files get re-read, work gets repeated.

`agent-contract` addresses this at three levels:

### 1. The always-on shim

Every shim file (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`) carries a marked block stating the rules the hooks mechanically enforce:

- **Declare a role before writing source** — run `.agent/checks/pre-generate.sh <task-spec.json> <role>`. This validates the spec **and** writes `.agent/session/active-role.txt`, which enables the scope-enforcement hooks. `active-role.txt` is contract-controlled, so hand-editing it is blocked; running `pre-generate.sh` (or a dispatcher) is the sanctioned way to set the role. With no role declared the guard falls back to inference (below) and blocks when the answer is not unique.
- **Stay inside the role's scope** — `.agent/roles/<role>.yaml` lists the writable globs; an empty list means read-only.
- **Contract files are off-limits in-session** — `.agent/roles/**`, `.agent/checks/**`, `.agent/session/active-role.txt`, `.claude/settings*`.
- **Fix only what was asked**, **ask when inputs are ambiguous**, and **log non-trivial decisions** to `.agent/memory/decisions.jsonl`.

The shim then lists the context that exists — manifest, codebase map, conventions, prior handoffs — and states explicitly that there is **no required reading order**.

Earlier versions mandated a numbered boot sequence instead. It was dropped deliberately: it forced four or five tool calls and a role/spec/scope planning problem before the task was even read, which spends reasoning on contract compliance rather than the problem. Current models choose a reading order well on their own, and the hooks enforce the rules regardless of what the model chose to read.

The contract is **non-optional** — it applies to every session, every task, every model, without needing to be mentioned in the prompt. The shim block is refreshed in place by `agent-contract update`, so a contract change reaches repos initialized long ago.

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
      users.controller.ts
      users.service.ts
      users.module.ts
    orders/
      orders.controller.ts
      orders.service.ts
      orders.module.ts
  common/
    filters/
    guards/
  main.ts
  app.module.ts
tests/
  app.e2e-spec.ts

## Entry Points
- src/main.ts

## Key Config Files
- package.json
- tsconfig.json

## Top-Level Dependencies
@nestjs/core, @nestjs/typeorm, pg, redis

## Agent Usage Protocol
An index, not required reading — use it when it saves a search, skip it when it does not.
Paths and symbols here can go stale; grep before trusting one.
...
```

Directories with more than 20 source files are annotated with a count instead of a full listing (e.g. `Controllers/  (42 files)`) so the map stays bounded on large codebases.

For greenfield projects (fewer than 5 source files), the map notes it's a new codebase and instructs the agent to architect from scratch.

`pre-generate.sh` also warns when `codebase-map.md` predates the last git commit — a signal that the map is stale and `agent-contract update` should be run before generating code.

### 3. Handoff notes

A handoff note is written:

- **Automatically by the Stop hook** — the Claude Code `Stop` hook runs `write-handoff.sh` after every agent turn that produces git changes. The note is saved to `.agent/memory/handoff-done-{timestamp}.md` with the active role, changed files, and last 5 decisions. No model cooperation required; turns with no changes are silently skipped.
- **At task completion** — after every successful `agent-contract run`, a note is saved to `.agent/memory/handoff-done-{timestamp}.md` with the role, task, token stats, and last 5 decisions.
- **At 85% of the context window** — a banner is shown and a second note is saved to `.agent/memory/handoff-{timestamp}.md` (no `-done-` suffix). Both formats match `handoff-*.md`, so either is found when a session looks for prior state.
- **By hand** — `.agent/templates/handoff.md` is there for a human or agent that wants to write one deliberately. It is no longer something the shim asks for on every task; the Stop hook already covers it without needing model cooperation.

The shim lists prior handoffs among the available context, so the next session can pick up the most recent one.

**Compaction:** `write-handoff.sh` keeps only the 5 most recent handoff files. Older ones are archived to `.agent/memory/handoff-archive.jsonl` (one JSON entry per file with `ts`, `role`, and `files` fields) and deleted. The archive runs in the background so it never adds latency to the session.

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
| claude-opus-5 / claude-opus-4-8 / claude-opus-4-7 / claude-opus-4-6 | 1,000,000 |
| claude-sonnet-5 / claude-sonnet-4-6 | 1,000,000 |
| claude-fable-5 / claude-mythos-5 | 1,000,000 |
| claude-opus-4-5 / claude-haiku-4-5 | 200,000 |
| claude-3-5-sonnet / claude-3-opus / claude-3-sonnet / claude-3-haiku | 200,000 |
| gpt-4o / gpt-4o-mini / gpt-4-turbo | 128,000 |
| gpt-3.5-turbo | 16,000 |
| claude-code (CLI, estimated) | 1,000,000 |
| anything unrecognised | 100,000 |

Matching is by prefix, so a dated variant such as `claude-opus-4-6-20260101` resolves to its
base model. An unrecognised model falls back to a deliberately conservative 100,000 so the
thresholds fire early rather than late.

On the `anthropic` provider the pre-flight size is an exact `count_tokens` call; everywhere
else it is estimated at 1 token per 4 characters. The post-run figure always comes from the
provider's reported usage when it returns one.

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

`--learn` runs as part of `init`, so it also writes the full scaffold on first use. On an already-initialized repo the init pass is idempotent (existing files are skipped), so re-running `init --learn` is safe.

Infers: paradigm (OOP vs functional), error style, file naming convention, test placement pattern.

## What it produces

```
your-repo/
├── .agent/
│   ├── manifest.yaml             ← single entrypoint (persona, stack refs, enforcement policy)
│   ├── stack.yaml                ← auto-generated; language/framework facts + shell commands
│   ├── conventions.yaml          ← engineering rules (paradigm, tone, module size, DB policy…)
│   ├── config.yaml               ← provider/model/effort config (env vars override; docs block refreshed by update)
│   ├── roles/                    ← one YAML per role (always regenerated from stack detection)
│   │   ├── generator.yaml
│   │   ├── integrator.yaml
│   │   ├── tester.yaml
│   │   ├── reviewer.yaml         ← convention compliance gate between tester and documenter
│   │   ├── debugger.yaml
│   │   ├── documenter.yaml
│   │   └── security.yaml
│   ├── checks/                   ← executable gates (stack-aware)
│   │   ├── pre-generate.sh       ← validates task spec before generation
│   │   ├── post-generate.sh      ← lint, typecheck, tests, role scope check (diff/outcome)
│   │   ├── debug-scope.sh        ← enforces fix-not-refactor
│   │   ├── security-audit.sh     ← credentials, insecure patterns, vulnerable deps
│   │   ├── scope-lib.sh          ← shared scope engine (sourced by the three guards below)
│   │   ├── scope-check.sh        ← PreToolUse hook (file tools): blocks out-of-scope writes
│   │   ├── bash-write-guard.sh   ← PreToolUse hook (Bash): blocks tampering with contract files
│   │   └── write-handoff.sh      ← Stop hook: auto-writes handoff on git changes
│   ├── templates/
│   │   ├── commit.txt
│   │   ├── pr.md
│   │   ├── debug-report.md
│   │   └── handoff.md            ← fill-in template agents complete at task end
│   ├── memory/
│   │   ├── decisions.jsonl                    ← append-only decision log
│   │   ├── codebase-map.md                    ← auto-generated repo index (refreshed on update)
│   │   ├── handoff-done-{timestamp}.md        ← written after every completed task
│   │   └── handoff-archive.jsonl              ← compacted old handoffs (keeps 5 most recent)
│   └── session/
│       ├── .gitignore                         ← excludes session state from git
│       └── active-role.txt                    ← set by pre-generate.sh/dispatcher; read by the guards (contract-controlled)
├── .claude/
│   └── settings.json                          ← Claude Code hooks (PreToolUse ×2 + Stop)
├── CLAUDE.md                                  ← shim: enforced rules + available context (marked, refreshed in place)
├── AGENTS.md                                  ← shim (same block)
├── .cursorrules                               ← shim (same block)
└── .github/copilot-instructions.md           ← shim (same block)
```

## Design

Three properties, in order:

1. **Discoverable** — any agent walking into the repo finds it without being told.
2. **Declarative** — describes constraints, not procedures.
3. **Verifiable** — every agent output is checkable against the contract before it lands.

### Enforcement model

Defaults to **hard-fail**: scope violations exit non-zero. The guiding principle is
**enforce on outcomes, not just actions** — checking the resulting `git diff` catches a
write no matter *how* it was made, while the per-tool hooks block the obvious cases early.
Enforcement runs at four layers:

| Layer | When | Mechanism |
|---|---|---|
| **PreToolUse — file tools** | Before each `Write`/`Edit`/`MultiEdit` | `scope-check.sh` is **fail-closed**: no role declared → all source writes blocked; declared role with no `roles/<role>.yaml` → blocked; a role whose `may_create`/`may_modify` are empty is **read-only** (e.g. `reviewer`, `security`) and may not write source. Otherwise it matches the target against the role's globs and blocks anything outside. |
| **PreToolUse — Bash** | Before each `Bash` command | `bash-write-guard.sh` closes the hole that file-tool checks can't see: a Bash command (`echo > …`, `sed -i`, `tee`, `rm`, `cp`/`mv`) that writes to a **contract-controlled** file. High-precision and conservative — it only blocks writes *adjacent* to a protected path, so reads like `cat .agent/roles/x` are untouched. General source writes via Bash are left to the outcome layer. |
| **post-generate — outcome check** | After `agent-contract run`, or as a pre-commit / CI gate | `post-generate.sh` re-runs the role scope check against the working tree compared to `HEAD` — staged, unstaged and untracked files alike (authoritative: independent of write method; commit or stash unrelated work first), enforces `max_lines_per_file` and `new_packages` policy, applies persona gates, then runs lint, typecheck, tests, and the coverage gate. Empty-scope roles are fail-closed here too. |
| **CI / git hook** | On commit / push | `debug-scope.sh` and `security-audit.sh` are **not** called by `agent-contract run` — wire them (and `post-generate.sh`) as a pre-commit hook or CI step. Hard gate before code lands. |

#### Contract-controlled files (the guards protect themselves)

Earlier versions let the agent write anything under `.agent/**` — including its own role
file, the role definitions, and the guard scripts. That let a session **escape its own
scope**: rewrite `active-role.txt` to switch roles mid-task, widen a role's globs, or edit
the checks. These paths are now **off-limits to the agent** at every layer (both PreToolUse
hooks block them; the outcome check leaves them to `agent-contract update`):

- `.agent/session/active-role.txt`
- `.agent/roles/**`
- `.agent/checks/**`
- `.claude/settings.json` / `.claude/settings.local.json`

Change these **out-of-band** — a human edit or `agent-contract update` — never from inside an
agent session. The rest of `.agent/**` (memory, decisions, handoffs) stays writable so the
model can record its work.

#### What this does and does not guarantee

- **Guaranteed (deterministic):** the *blast radius* of agent writes. Contract files can't be
  self-modified; out-of-scope and read-only-role writes are blocked; the outcome check binds
  the final diff to the active role regardless of how files were written.
- **Best-effort:** the Bash guard is a high-precision speed bump, not an airtight parser —
  Bash has unlimited ways to mutate a file. The authoritative backstop for *source* writes is
  the `post-generate.sh` diff check; wire it as a pre-commit/CI gate to make it binding.
- **Not enforceable by the contract alone (needs a human/dispatcher):** that the *correct*
  role was chosen for a task, and that a logged decision is *sound*. The contract constrains
  what a role may do; it can't judge whether the right role was picked. For the strongest
  guarantee, have the entry point (dispatcher, ticket, or human) write `active-role.txt`
  rather than letting the agent self-select.

> **Upgrading an existing repo:** run `agent-contract update` to regenerate the check scripts
> and add the new Bash hook to `.claude/settings.json`. Both are idempotent.

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
scope:
  may_create: [<test globs>]            # a regression test
  may_modify: [<source globs>, <test globs>]
inputs_required: [symptom, diagnosis, affected_files, selected_solution]
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
