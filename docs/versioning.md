# Project versioning

## Source of truth

`package.json.version` is the application release version. npm maintains the matching root versions in `package-lock.json`. Do not change dependency versions, database schema versions, Redis namespaces, media URLs or API paths just to increment the application version.

The server-rendered Settings page reads the package version and passes only that string to the About section. The package manifest, dependencies and deployment configuration are not imported into client components. There is no runtime version environment variable to keep in sync, public version endpoint, version banner or version in page titles. A deployment's Git commit identifies its exact source; the release tag identifies the tested release commit.

The package stays `private: true` and `UNLICENSED`. A Git release tag does not publish an npm package or change source-code rights.

## Choosing a version

Use `MAJOR.MINOR.PATCH`:

- **PATCH:** compatible bug fixes, security fixes and small UI corrections.
- **MINOR:** compatible new features or capabilities.
- **MAJOR:** breaking changes to supported behavior, API contracts or required migration/configuration steps.

Optional prereleases such as `1.1.0-rc.1` identify versions still under evaluation. Dependency updates follow the impact on ReeloGram; do not automatically copy a dependency's version. Document migrations explicitly and keep database migrations independently identified.

## Preparing an update

From the repository root:

```sh
# Choose exactly one increment. This does not commit, tag or push.
npm version patch --no-git-tag-version
# Alternatives: npm version minor --no-git-tag-version
#               npm version major --no-git-tag-version
#               npm version 1.1.0-rc.1 --no-git-tag-version

npm run version:check
npm run lint
npm run typecheck
npm test
npm run build
```

The npm `version` lifecycle checks both manifests and creates a note draft for the new version. `pretest` and `prebuild` also reject version drift. Run relevant integration checks for the affected area; Redis/auth/upload changes need their existing integration suites. Stop the local dev server before a production build uses `.next`, then restore development on port 3000.

Review the package/lockfile diff: a version-only update should not refresh dependencies. Commit all reviewed release changes before tagging. Use an annotated `v<package version>` tag on that exact tested commit. Never move or overwrite a published release tag; fixes get a new patch release. Push the intended commit and explicit tag, rather than all local tags. Verify deployment success and production smoke checks.

Example for a future tested release (substitute its actual version):

```sh
git tag -a v1.0.1 -m "ReeloGram v1.0.1"
git push origin main
git push origin v1.0.1
```

Tagging is a deliberate final step, not an automatic side effect of builds or deployments. No GitHub Release or release-note publishing automation is configured.

## Unpublished version notes

`npm run release:notes` creates `.release-notes/v<version>.md`. The directory is ignored by Git and is outside `public` and the application routes. Notes are not bundled, deployed, displayed in the app, or attached to a GitHub Release. Running the command again preserves any edits. These local drafts are not backed up by Git; the tracked generator provides the template on other machines.

Record user-facing changes, compatibility/configuration requirements, verification results and rollback steps. Never record credentials, private customer information or detailed exploit instructions. Leave unreleased dates and commit IDs pending rather than inventing them. Publish notes only after an explicit decision to do so; a version tag alone is not a release announcement.

For rollback, redeploy the previous verified commit without moving its tag. Check whether data/configuration changes are backward compatible first. A redeploy does not undo a database migration or restore deleted data.
