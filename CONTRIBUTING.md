# Contributing

Thanks for helping. Small pull requests are easiest to review.

## Development setup

```bash
git clone https://github.com/nicoleyangcoding/docs-drift-check
cd docs-drift-check
npm ci
npm run all
```

- `src/action.ts` holds the logic and talks to GitHub through a small interface, so tests use a fake instead of the network.
- `src/index.ts` wires that interface to the real GitHub API.
- Commit the rebuilt `dist/` with your change. CI checks that it matches the source.

## Guidelines

- Never check out or run pull request code.
- Keep the comment short: one heading, one table, one sentence.
