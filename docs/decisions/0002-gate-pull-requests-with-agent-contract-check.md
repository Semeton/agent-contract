# 0002 — Gate pull requests with `agent-contract check`

- **Status:** accepted
- **Date:** 2026-10-19
- **Changes:** `.github/workflows/check.yml` (new), `docs/pull_request_template.md` (new)

## Context

The in-session layer (role scopes, Bash guard, decision log) proved mostly redundant with
current models and Claude Code's native permissions and sandbox: it cost a role switch per
area of a change and never stopped a model wandering out of scope. The merge gate, which
reads the diff rather than the agent, worked on first use.

On the day the gate shipped, two commits reached `master` with no gate at all: one changed
`package.json` with no recorded reason, and one committed an unrelated `CLAUDE.md` change
under the message of the `package.json` fix. Direct pushes skip every check.

## Decision

- Run `agent-contract check` on every pull request, from the repo's own `bin/` so a PR is
  checked by the version of the gate it carries.
- Changes land through pull requests, including the maintainer's. Protect `master` so the
  check is required.
- The PR template asks for a `## Decision` section and says when it is needed.

## Consequences

- Sensitive changes — dependency manifests, workflows, the contract's scopes and guards —
  cannot merge without a recorded reason.
- A PR can edit the gate it is checked by. Branch protection plus review is what covers that;
  the gate is not a substitute for reading the diff.
- This is also the measurement for whether agent-contract earns further work: count how
  often the gate fails a PR, and how often that failure was right.
