# Docs Drift Check

A GitHub Action that notices when a pull request changes code but not the docs that describe it, and leaves one polite comment.

Docs go stale one pull request at a time, and reviewers rarely remember which page covers which code. You write that down once in a small mapping file, and the action reminds people at the moment they can still fix it.

> ### Docs may need an update
>
> This pull request changes code that has related documentation, but the docs weren't changed.
>
> | Area | Changed code | Docs to check |
> | --- | --- | --- |
> | Authentication | `src/auth/login.ts`, `src/auth/session.ts` | `docs/authentication.md` |
>
> If the docs are still accurate, add the `docs-not-needed` label and this check will pass.

## Quick start

**1. Add `.github/docs-map.yml`:**

```yaml
mappings:
  - name: Authentication
    code: "src/auth/**"
    docs: docs/authentication.md

  - name: Public API
    code: ["src/api/**", "src/routes/**"]
    docs: [docs/api.md, README.md]
```

**2. Add `.github/workflows/docs-drift.yml`:**

```yaml
name: Docs drift
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: nicoleyangcoding/docs-drift-check@v1
```

That's all. No checkout step is needed: the action reads everything through the GitHub API.

## How it decides

- A mapping is **triggered** when the pull request changes, adds, deletes or renames a file matching its `code` patterns.
- It counts as **updated** if the same pull request changes any one of its `docs`.
- Triggered but not updated means drift, and the action comments.
- Later pushes edit the same comment instead of adding new ones. When the docs get updated, the comment changes to "Docs look up to date". The action never comments when there was nothing to say.

## Configuration

`.github/docs-map.yml`:

| Key | Meaning |
| --- | --- |
| `mappings` | List of areas to watch. Required. |
| `mappings[].code` | Glob or list of globs for the code in that area. |
| `mappings[].docs` | File, glob or list of the docs that describe it. |
| `mappings[].name` | Label shown in the comment. Optional. |
| `ignore` | Globs that never trigger a mapping, like tests: `["**/*.test.ts"]`. Optional. |

Patterns use [minimatch](https://github.com/isaacs/minimatch) syntax: `*` matches within a folder and `**` matches across folders.

The mapping file is read from the **base branch**, so a pull request can't loosen its own check. If the base branch has no mapping file yet (for example, in the pull request that adds it), the pull request's copy is used.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `config` | `.github/docs-map.yml` | Path to the mapping file. |
| `mode` | `warn` | `warn` only comments. `strict` also fails the check. |
| `skip-label` | `docs-not-needed` | Pull requests with this label pass. |
| `comment` | `true` | Set to `false` to write only to the job summary. |
| `github-token` | `github.token` | Token used to read the pull request and comment. |

## Outputs

| Output | Description |
| --- | --- |
| `drift` | `true` when some docs were not updated. |
| `areas` | JSON list of `{ name, docs }` for each area that needs attention. |

## Pull requests from forks

On `pull_request` events from forks, GitHub gives the workflow a read-only token, so the action can't comment. It writes the result to the job summary instead and adds a warning. Don't switch to `pull_request_target` to work around this unless you understand the [security implications](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/). This action never checks out or runs pull request code.

## Development

```bash
npm ci
npm run all     # typecheck, test, build dist/
```

`dist/` is committed because GitHub runs it directly. CI fails if it's out of date. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [roadmap](ROADMAP.md).

## License

[MIT](LICENSE). Licenses of bundled dependencies are in [dist/licenses.txt](dist/licenses.txt).

<!-- self-test -->
