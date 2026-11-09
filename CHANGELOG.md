# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-11-09

### Added
- Each doc in the comment links to that file as of the pull request's latest commit. Glob patterns stay as plain text.

## [1.0.0] - 2026-10-29

### Added
- Mapping file linking code globs to docs, read from the base branch
- One pull request comment that is edited in place, never duplicated
- `warn` and `strict` modes, a skip label, and `drift` / `areas` outputs
- Job summary fallback for pull requests from forks
