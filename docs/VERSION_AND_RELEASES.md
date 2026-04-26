# Version Control and Releases

This guide explains how PicTur tracks versions, maintains a changelog, and uses GitHub Releases.

## Where versions are tracked

| Component      | Location                    | Purpose |
|----------------|-----------------------------|--------|
| **App version**| `frontend/package.json` → `version` | Single product version for the whole repo (releases, CHANGELOG, GitHub Releases). Bump when you cut a release. |
| **Auth backend** | — | No version field; not tracked. |
| **Backend**    | — | Python backend has no `__version__`; optional to add in `backend/__init__.py` if needed. |

## CHANGELOG.md

- **Location:** project root: `CHANGELOG.md`.
- **Format:** [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (e.g. `1.2.3`).

### Sections

- **\[Unreleased\]** – changes merged to `main` but not yet released. Move these into a new `[X.Y.Z]` block when you release.
- **\[X.Y.Z\]** – released versions with a date and compare links at the bottom.

### When to update

1. **When merging a PR:** add a short line under `[Unreleased]` in the right category:
   - **Added** – new features
   - **Changed** – behavior changes
   - **Deprecated** – soon-to-be removed
   - **Removed** – removed features
   - **Fixed** – bug fixes
   - **Security** – security-related changes

2. **When releasing:** move `[Unreleased]` entries into a new `[X.Y.Z] - YYYY-MM-DD` section and add the compare/release links at the bottom.

Example:

```markdown
## [Unreleased]

### Added
- Admin can export review queue to CSV.

### Fixed
- Photo upload failing for large images.

## [0.2.0] - 2025-03-15
...
```

## GitHub Releases

Releases are created manually from **tags** (e.g. `v0.1.0`, `v1.0.0`).

### Creating a release

1. **Bump version and finalize CHANGELOG**
   - In `frontend/package.json`, set `version` to the new number (e.g. `0.2.0`).
   - In `CHANGELOG.md`, move everything from `[Unreleased]` into a new section:
     - `## [0.2.0] - YYYY-MM-DD`
   - Add the new compare links at the bottom (see existing entries in `CHANGELOG.md`).
   - Commit: e.g. `Release 0.2.0` or `chore: release 0.2.0`.

2. **Create and push the tag**
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. **Create the GitHub Release**
   - On GitHub: **Releases** → **Draft a new release** → choose tag `v0.2.0`, paste the release notes from the corresponding section of `CHANGELOG.md`, then publish.

4. **Optional:** start the next cycle by adding a new `[Unreleased]` section and a compare link from the new tag to `HEAD` in `CHANGELOG.md`, then commit.

---

## Should you release after every merged pull request?

**Short answer: no.** Releasing on every merged PR is usually not a good idea.

| Approach | Pros | Cons |
|----------|------|------|
| **Release on every merged PR** | Very frequent “releases” | Noisy; version number explodes; no clear “what’s in this release”; hard to communicate to users. |
| **Release when you have a meaningful batch** (recommended) | Clear versions; one place to read “what changed”; easier to test and roll back. | You must remember to bump and tag. |
| **Scheduled releases** (e.g. weekly/monthly) | Predictable. | Some releases may be empty or tiny. |

**Recommended:** Use **semantic versions** and release when:

- You have a set of changes you’re happy to deploy (e.g. after a feature branch is merged and tested), or
- You fix an important bug and want a patch release (e.g. `0.1.0` → `0.1.1`), or
- You want a clear milestone (e.g. “first production-ready” → `1.0.0`).

So: **merge PRs as often as you like**, keep **CHANGELOG.md** updated with each merge, and **create a GitHub Release (and tag) only when you decide a new version is ready**.

---

## Summary

- **Version:** Bump `frontend/package.json` when you cut a release (only place we track version).
- **CHANGELOG.md:** Update on every merged PR under `[Unreleased]`; when releasing, move those entries into a new version section and add links.
- **GitHub Releases:** Create a tag (e.g. `v0.2.0`), push it, then create the release on GitHub and paste notes from the changelog.
- **When to release:** When you have a meaningful batch of changes or an important fix—not necessarily after every merged PR.
