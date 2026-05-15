# Publishing to npm

This guide covers the exact steps to get `agent-contract` published. You (the human) run every command. Nothing here can be automated for you, and you wouldn't want it to be.

## One-time setup

### 1. Pick your scope

The package name in `package.json` is currently `@CHANGE-ME/agent-contract`. Decide what to put there:

- **Personal scope**: `@takayama/agent-contract` (or whatever your npm username is)
- **Brand scope**: `@codeplified/agent-contract`
- **Unscoped**: `agent-contract` — only if the name isn't taken on npm. Check first: `npm view agent-contract`.

Scoped packages are recommended. They prevent name collisions and make ownership obvious.

Edit `package.json` and replace `@CHANGE-ME` everywhere (also in `repository.url`, `bugs.url`, `homepage`).

### 2. Create the GitHub repo (optional but recommended)

```bash
gh repo create agent-contract --public --source=. --remote=origin
```

Or manually: create the repo on GitHub, then:

```bash
git remote add origin git@github.com:YOUR-USERNAME/agent-contract.git
git push -u origin main
```

The `repository`, `bugs`, and `homepage` fields in `package.json` show up on the npm package page and matter for SEO/discoverability.

### 3. npm account

If you don't have one: `npm adduser` (creates one, then logs in).
If you do: `npm login`.

Confirm: `npm whoami` should print your username.

Enable 2FA for publishing if you haven't already:

```bash
npm profile enable-2fa auth-and-writes
```

This forces an OTP on every `npm publish` — worth the friction. Anthropic's tools won't have your 2FA codes, which is exactly the point.

## Pre-publish checks

From the package root:

```bash
# 1. Run the smoke test
npm test

# 2. Dry-run the publish — shows exactly what files would ship
npm publish --dry-run --access public

# 3. Inspect the tarball contents
npm pack --dry-run
```

Verify:
- `package.json`, `README.md`, `LICENSE`, `bin/`, `lib/` are included
- `test/`, `fixtures/`, `.git/` are NOT included
- Total package size is small (~30 KB unpacked)

## Publish

```bash
npm publish --access public
```

The `--access public` flag is **required** for scoped packages. Without it, npm tries to publish privately, which requires a paid plan.

When prompted, enter your 2FA OTP.

If successful:

```
+ @your-scope/agent-contract@0.1.0
```

Verify it's live:

```bash
npm view @your-scope/agent-contract
```

And test the install path immediately:

```bash
cd /tmp && mkdir test-install && cd test-install
echo '{"name":"x","dependencies":{"@nestjs/core":"^10"}}' > package.json
npx @your-scope/agent-contract init
ls .agent/
```

## Subsequent releases

1. Make changes.
2. Bump version: `npm version patch` (bug fix), `npm version minor` (new feature), `npm version major` (breaking).
3. Push: `git push && git push --tags`.
4. Publish: `npm publish` (smoke test runs automatically via `prepublishOnly`).

## Unpublishing

You have a 72-hour grace period after first publishing a version to unpublish it. After that, npm only lets you deprecate, not delete:

```bash
# Within 72 hours: full unpublish (use sparingly)
npm unpublish @your-scope/agent-contract@0.1.0

# After 72 hours: deprecate (preferred for any real release)
npm deprecate @your-scope/agent-contract@0.1.0 "use 0.1.1 instead"
```

## Common gotchas

- **`E402 Payment Required`**: you forgot `--access public` on a scoped package.
- **`E403 You do not have permission`**: scope mismatch — your npm username doesn't own the scope. Either change the scope to one you own, or transfer ownership via npm web UI.
- **`prepublishOnly` test fails**: don't bypass it with `--ignore-scripts`. Fix the test or the bug.
- **OTP prompt times out**: re-run; npm regenerates the OTP window.
