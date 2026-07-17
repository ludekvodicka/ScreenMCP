# Contributing to ScreenMCP

Bug reports and focused pull requests are welcome. For security issues, follow [SECURITY.md](SECURITY.md)
instead of opening a public issue.

## Development setup

Use Node.js 24 and npm 11:

```sh
npm ci
npm run dev
```

Before submitting a change, run:

```sh
npm run check
```

Changes to desktop capture should also follow [the manual smoke checklist](docs/testing/smoke-checklist.md).
Platform-specific capture or packaging changes should state which operating systems were exercised.

## Pull requests

- Keep each pull request focused and explain the user-visible behavior.
- Add or update tests for state, geometry, privacy, and updater behavior.
- Update `docs/architecture` for significant design changes.
- Never commit endpoint tokens, settings, screenshots with private data, signing material, or local
  machine paths.
- Do not weaken localhost binding, bearer validation, consent, STOP, redaction ordering, or the public
  release gates without an explicit security rationale.

The maintainer's internal source of truth is SVN and GitHub is a reviewed public projection. After a
PR merges, the maintainer backports it into the internal tree before the next public sync. Contributors
do not need SVN access or any private tooling.
