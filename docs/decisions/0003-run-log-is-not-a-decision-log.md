# 0003 — The run log is not a decision log; decisions live in docs/decisions/

- **Status:** accepted
- **Date:** 2026-11-02
- **Changes:** `lib/util/runlog.js` (new), `lib/util/decisions.js` (new), `lib/commands/{run,status,init,update,check}.js`, `lib/util/{templates,map}.js`, `package.json` (0.10.0)

## Context

`.agent/memory/decisions.jsonl` was written by `agent-contract run`: one line per run with role,
task, model and token usage. It held no decisions. The shim also told agents to "log
non-trivial decisions" in the same file, free-form, with no schema, no review and no evidence.

Two gates read it:

- `post-generate.sh` treated the word `approv` anywhere in its last 10 lines as human approval
  for a dependency change. The agent being checked could append that line itself.
- The architect-persona gate required the last line to contain `"task"`. Every run line does,
  so it never failed.

[repo-memory](https://github.com/Semeton/repo-memory) now owns decision records: Markdown files
in `docs/decisions/` with evidence checked in CI, written by agents only as proposals and
accepted by a human. With both tools installed, an agent got two contradictory instructions
for where a decision goes, and one of them had no human in the path.

## Decision

- The run log is renamed `.agent/memory/runs.jsonl` and documented as telemetry. `run`,
  `status` and the handoff notes read it, falling back to `decisions.jsonl` for older installs.
- An old `decisions.jsonl` is renamed (by `update`, `init` or the next `run`) only when every
  line in it is a run entry. A file with anything else in it is left byte-for-byte in place and
  reported by `update` and `status`; guessing which lines are decisions would be worse.
- The shim, agent README, codebase map, PR and handoff templates send decisions to
  `docs/decisions/`: as a repo-memory proposal when `repo-memory.json` exists, otherwise as an
  ADR. The wording is chosen when `init` or `update` runs.
- The two gates become notices. Dependency edits are still blocked in-session by role scopes
  (no default role may write `package.json`) and still need a recorded decision at merge.
- `agent-contract check` accepts a decision file in repo-memory's configured folder as well as
  `decisions_dir`, and treats `repo-memory.json` as a sensitive path.
- The tools stay independent: agent-contract detects repo-memory by its config file and never
  requires it.

## Consequences

- No in-session gate passes because the agent wrote a word into a file it can append to.
- Repos that hand-wrote decisions into `decisions.jsonl` keep them, with a prompt to move them.
- Existing `manifest.yaml`, `.agent/README.md` and `templates/` are preserved by `update`
  unless `--force`, so they keep the old wording until refreshed. The shim, which agents
  actually read, is refreshed by a plain `update`.
- Installing repo-memory after agent-contract needs one `agent-contract update` to re-point
  the shim.
