# 0001 — Publish to npm from GitHub Actions with trusted publishing

- **Status:** accepted
- **Date:** 2026-10-19
- **Changes:** `.github/workflows/publish.yml` (new)

## Context

`npm publish` from a laptop needs a one-time 2FA code on every release. The 0.9.0 release
stalled on that: the code is short-lived and is a credential, so it should not be handed to an
agent, and the alternative — a granular token with "bypass 2FA" — leaves a long-lived publish
credential on disk.

## Decision

Publish from a GitHub Actions workflow using npm trusted publishing (OIDC):

- The workflow runs only on `v*` tag pushes.
- `permissions: id-token: write` lets npm verify the workflow's identity; no npm token is
  stored in the repo or its secrets. The package's Trusted Publisher setting on npmjs.com names
  this repo and `publish.yml`, so no other workflow or repo can publish it.
- `--provenance` links each published version to the commit and workflow run that built it.
- `npm publish` runs `prepublishOnly`, so the full smoke suite gates every release, as it did
  locally.

Release: `git tag vX.Y.Z && git push origin vX.Y.Z` after the version bump is committed.

## Consequences

- Releases no longer depend on a local npm login or 2FA prompt.
- Anyone who can push a `v*` tag can publish. Protect tags (repository rulesets → tag
  protection for `v*`) so that stays limited to maintainers.
- The workflow was written by a human, not in-session: the contract treats
  `.github/workflows/**` as contract-controlled for every role, because a workflow runs with
  the repository's secrets.
- If trusted publishing is not configured on npmjs.com, the publish step fails with an auth
  error; nothing is published.
