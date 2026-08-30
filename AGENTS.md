# Window Router repository instructions

## Release versioning

- Every release must update the version in `manifest.json`, regardless of the
  type of change it contains.
- Use a patch version for fixes, a minor version for backward-compatible
  features, and a major version for breaking changes.
- Add a dated entry for the same version to `CHANGELOG.md`. Describe the user
  impact in plain language.
- Keep the current version shown in `README.md` aligned with `manifest.json`.
- Before publishing, run `bun test`, the browser build, a manifest parse check,
  and `git diff --check`.
