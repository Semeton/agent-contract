# agent-contract — repo context for Claude Code

This is the **source code for `agent-contract` itself** — a CLI that installs a deterministic contract layer into target repos.

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
    run.js                  ← dispatches role + task to a provider
    update.js               ← selective refresh (roles, checks, map; leaves conventions)
  detect/
    index.js                ← detector pipeline + scoring
    detectors/
      node.js               ← NestJS, Next.js, Express, Fastify, ...
      php.js                ← Laravel, Symfony, ...
      python.js             ← Django, Flask, FastAPI
      go.js, rust.js, java.js, ruby.js, dotnet.js
  learn/
    index.js                ← --learn: samples source files, infers conventions draft
  providers/
    anthropic.js            ← Anthropic provider (claude-opus-5, streaming, adaptive thinking,
                               output_config.effort, cached system prefix, count_tokens)
    openai.js               ← OpenAI provider (gpt-4o pin — see the note in the file)
    claude-code.js          ← claude CLI provider (Pro/Max, no API key)
    echo.js                 ← dry-run echo provider
  util/
    scope.js                ← role-scope parser + widening diff (JS twin of scope-lib.sh)
    yaml.js                 ← minimal hand-rolled YAML emitter (no js-yaml dep)
    fs.js                   ← idempotent file writer (create-only / merge-shim / overwrite)
    hooks.js                ← idempotent .claude/settings.json hook installer
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

## Scope model — read before touching role scopes

Role YAMLs are **generated** from `frameworkScopes()` + `roleYaml()` in `lib/util/templates.js`,
which sits inside the `lib/**` glob an integrator-scoped agent may modify. That made
"edit the generator, re-run `update`" a self-service scope escalation. Two things close it:

- `update` diffs each regenerated role against the one on disk and **refuses** when a role
  would gain a writable or deletable glob. Consent is `--allow-scope-change` (or `--force`,
  which already means overwrite-the-contract).
- `bash-write-guard.sh` blocks both flags from inside a session (RE3), so consent can only
  come from a human terminal or a human-run CI step.

If you change `frameworkScopes()` or a role's `scope:`, expect `update` to stop and print the
widened globs. That is the guard working. Review the paths, then re-run with consent.

The same reasoning applies one level up, to the guards themselves. `update` regenerates every
`.agent/checks/*.sh` from these templates, so "edit `bashWriteGuardScript()`, run plain
`update`" was a two-step route to neutering enforcement — and plain `update` is deliberately
*not* blocked, because that is the self-update path. Two things close it:

- **`update` requires consent for enforcement changes when the tool is self-hosted or
  vendored** — i.e. when the running `lib/util/templates.js` is inside the repo being updated,
  which is the only case where an agent's `lib/**` scope reaches the guards. In a normal target
  repo the templates come from the installed package, are upstream, and flow through a plain
  `update` untouched. Breaking that would break self-update.
- **`scope_is_protected_abs`** in `scope-lib.sh` blocks writes to an installed
  `agent-contract/{lib,bin}/` or to `.claude/settings*.json` **anywhere on disk**. Writes
  outside the repo were previously allowed unconditionally, which meant any target repo could
  reach the globally installed CLI and tamper with the templates from there. Unrelated
  out-of-repo writes (tmp, scratch dirs, sibling projects) stay allowed — this is a
  toolchain-integrity rule, not a sandbox.

`scope-check.sh` re-defines `scope_is_protected_abs` locally if `scope-lib.sh` predates it. An
undefined function returns 127, which `if` reads as "not protected" — the guard would have
failed open on exactly the writes it was added to block.

**Consent is a terminal property, not a string pattern.** `update` refuses
`--allow-scope-change` and `--force` when `process.stdin.isTTY` is false. This replaces regex
matching as the *primary* control: `F=--force; agent-contract update $F` defeats any pattern
the Bash guard can carry, but it cannot conjure a controlling terminal, and the decision is
made by the program receiving the flag rather than by inspecting how it was typed. CI has no
TTY either, so `AGENT_CONTRACT_NONINTERACTIVE_CONSENT=1` is the documented hatch — anyone able
to set an env var in a CI config is a human with write access. The Bash guard blocks that
variable's literal form (RE4), so the obvious in-session spelling is still refused.

If you add a test or script that drives `update({flags: {force: true}})` programmatically, set
that env var; the smoke suite does exactly this and unsets it again to prove the gate bites.

**Detection, not only prevention.** `pre-generate.sh` hard-fails when `.claude/settings.json`
exists but no longer references `scope-check.sh` and `bash-write-guard.sh` — unwired hooks turn
every scope rule into a suggestion, and that should not be silent. A *missing* settings.json
only warns, since Cursor/Copilot repos never had the hooks. `agent-contract status` reports the
same thing plus per-check drift against the installed templates and any role scope wider on
disk than the template would emit. An attacker who has already disarmed the hooks has won;
these exist so a human or a CI step notices.

Twin-parser risk is now a tested property rather than a warning: the smoke suite runs
`scope_role_patterns` from `scope-lib.sh` and `parseRoleScope` from `scope.js` over a corpus of
adversarial YAML shapes and asserts the JS copy never sees fewer globs than the shell. Confirmed
to bite — re-introducing the old `scope:`-block-only reading fails two corpus entries.

`lib/util/hooks.js` is additive-only: `installClaudeHooks` adds a hook when absent and never
removes one, so tampering with it does not disarm an already-initialized repo.

## Role inference

`scope-check.sh` used to block every source write until `pre-generate.sh` had run, which cost a
turn at the start of any session not dispatched through `agent-contract run`. It now derives the
role from the write target instead:

- The basis is **whether the file already exists** — an existing file resolves against
  `may_modify`, a new one against `may_create`. That is what makes the answer unique in
  practice: editing `lib/x.js` is integrator, creating it is generator.
- **Exactly one candidate that declares no `inputs_required`** → that role is inferred,
  persisted to `active-role.txt`, and the write proceeds with a one-line note on stderr.
- **Zero candidates, but some require a spec** → blocked with `reason=spec-required`. This is
  the generator case: new source still needs a filled-in spec, which is the whole point of the
  gate.
- **More than one candidate**, or **none at all** → blocked, listing what it considered.

Inference grants nothing. Every write is still checked against the chosen role's globs, so it
can only ever select a role that would have permitted that write anyway — the tests assert that
an inferred tester still cannot write `lib/`. An explicitly declared role is never overridden,
and contract-controlled paths are rejected before inference is reached.

## Why conventions are not emitted as a Skill

Considered and declined. Progressive disclosure was the goal, and the shim already achieves it:
it lists `conventions.yaml` as available context and states there is no required reading order,
so the file costs nothing in sessions that do not need it and ~230 tokens in those that do. A
Skill would be Claude Code-only — cutting against the Cursor/Copilot/AGENTS.md portability that
is a core reason this project emits plain files — and would create a second representation of
the same policy to keep in sync. The cost is real and the saving is not.

**`package.json` is deliberately in no role's scope.** It is the dependency manifest, and
zero runtime dependencies is a headline property of this package — an agent that can edit it
can add a dep. Version bumps go through `npm version <major|minor|patch> --no-git-tag-version`,
which is a release action, not a task action.

## Known gaps / future work

1. YAML emitter is one-way (emit only). If users start editing contract files we'll need to read them back; swap in `js-yaml` then. `lib/util/scope.js` is a targeted read-side parser for the one case that needed it, not a general reader.
2. No orchestrator feedback loop — role YAMLs declare the contract, but `agent-contract run` dispatches a single turn rather than a multi-step loop with re-checking.
3. `--learn` output (`conventions.draft.yaml`) is not auto-merged; the human must copy it into `conventions.yaml` manually.
4. `lib/util/scope.js` and the emitted `checks/scope-lib.sh` parse role scopes independently. A conformance test asserts they agree over an adversarial corpus, so a divergence fails the suite rather than silently weakening `update`'s guard — but they are still two implementations. Change them together, and add a corpus entry for whatever shape prompted the change.
5. The OpenAI provider's model is pinned to `gpt-4o` on purpose — this project does not track OpenAI's lineup, and a guessed id fails as a 404 at request time. Override with `OPENAI_MODEL` or `model:` in `.agent/config.yaml`.

## Publishing

See `PUBLISHING.md`. Scope is `@CHANGE-ME` — must be replaced before first publish.

<!-- agent-contract:shim -->
# Agent Contract — ALWAYS ACTIVE

Enforcement here is mechanical, not advisory: PreToolUse hooks read `.agent/` and exit
non-zero to block a write. These rules hold whether or not the prompt mentions them.

- **Declare a role before writing source.** Run `.agent/checks/pre-generate.sh <spec.json> <role>` —
  it validates the spec and sets the active role. Roles: generator integrator tester reviewer debugger documenter security.
  With no role declared, the guard infers one from the write target when exactly one role
  can account for it, and blocks otherwise. Creating new source always needs the explicit
  gate, because generator declares `inputs_required`.
- **Stay in your role's scope.** `.agent/roles/<role>.yaml` lists the writable globs; an empty list means read-only.
- **Contract files are off-limits in-session** — `.agent/roles/**`, `.agent/checks/**`,
  `.agent/session/active-role.txt`, `.claude/settings*`. Change those out-of-band: a human edit or `agent-contract update`.
- **Fix only what was asked** (`refactor_policy: forbidden_unless_explicitly_approved`).
- **Ask when inputs are ambiguous** — do not fill in defaults.
- **Log non-trivial decisions** to `.agent/memory/decisions.jsonl`.

Available context — read what the task needs, there is no required reading order:
`.agent/manifest.yaml` (contract index), `.agent/memory/codebase-map.md` (file index),
`.agent/conventions.yaml` (style policy), `.agent/memory/handoff-*.md` (prior sessions).
Handoff notes are written for you by the Stop hook.
<!-- /agent-contract:shim -->
