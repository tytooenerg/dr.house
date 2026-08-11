# Publishing the official SDKs — what's real, what's still needed

Both SDKs (`sdks/node` → `@lastro/sdk`, `sdks/python` → `lastro-sdk`) are complete, real, and tested — each has a genuine end-to-end test suite that spins up the actual Lastro server and drives every method against it over a live HTTP connection (`sdks/node/test/`, `sdks/python/tests/`), not a mocked-HTTP smoke test. Neither has ever been published to a real package registry, because **no real npm or PyPI account exists in this environment** — this document is the honest, complete checklist for a maintainer who does have those accounts to actually publish them for real.

## What already exists (built, no action needed)

- `.github/workflows/publish-sdks.yml` — a real, manual-only (`workflow_dispatch`) GitHub Actions workflow. It typechecks, runs the real test suite, builds, and publishes each SDK — but only once the secrets below exist, and never fires on its own (no push/tag trigger, so adding this file changes nothing until someone deliberately runs it from the Actions tab).
- `sdks/node/package.json` ships with `"private": true` as a real safety default — a stray local `npm publish` can never accidentally publish it. The workflow strips that flag only in its own publish step, and never commits the change back to the repo.
- Package names are already chosen and typed into the manifests: `@lastro/sdk` (npm, scoped under an `@lastro` npm org) and `lastro-sdk` (PyPI).

## What a real maintainer still needs to decide/do

1. **Confirm the package names are actually available.** `@lastro/sdk` requires owning (or being a member of) the `lastro` npm org — check at [npmjs.com/org/create](https://www.npmjs.com/org/create) or via `npm org ls lastro` if it might already exist. `lastro-sdk` on PyPI: check [pypi.org/project/lastro-sdk](https://pypi.org/project/lastro-sdk/) — this repo has no way to confirm either name is actually free from here.
2. **Pick a real license.** `sdks/python/pyproject.toml` currently declares `license = { text = "UNLICENSED" }` — meaning, legally, nobody may use it. That's a deliberate safe default, not a real decision on the maintainer's behalf: choosing a real open-source license (MIT is the common choice for a thin API client SDK, but that's a business decision, not a technical one) and adding a real `LICENSE` file to both `sdks/node/` and `sdks/python/` is a prerequisite for a publish that's actually usable by anyone.
3. **Create the real accounts and tokens:**
   - An npm account (or org) with publish rights to `@lastro/sdk`, then an [npm automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens).
   - A PyPI account, then a [PyPI API token](https://pypi.org/help/#apitoken) scoped to the `lastro-sdk` project (or your whole account, for the first publish before the project exists on PyPI).
4. **Add the tokens as GitHub Actions secrets**, matching the environment names the workflow references (`npm-publish` → `NPM_TOKEN`, `pypi-publish` → `PYPI_API_TOKEN`) — Settings → Environments (recommended, so the tokens are scoped and require review) or Settings → Secrets → Actions.
5. **Bump the version** in `sdks/node/package.json` and `sdks/python/pyproject.toml` if this isn't the very first publish — both currently sit at `1.0.0`, matching `docs/api-versioning-policy.md`'s semver rules for the SDKs.
6. **Run the workflow** from the Actions tab (`Publish SDKs` → `Run workflow`), choosing which of the two to publish.

Until all of the above is done, `client/src/pages/public/DocsPage.tsx`'s getting-started section correctly tells a visitor to install from source (`sdks/node`, `sdks/python` in this repo) rather than from a registry — update that copy once a real publish actually happens.
