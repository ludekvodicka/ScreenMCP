# Security policy

## Supported versions

Security fixes target the latest published ScreenMCP release. Older prerelease builds may be asked to
upgrade before a report is investigated.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/ludekvodicka/ScreenMCP/security/advisories/new).
Do not include tokens, captured pixels, private window titles, or exploit details in a public issue.
Include the ScreenMCP version, operating system, package type, impact, and minimal reproduction.

ScreenMCP binds its MCP server to localhost and protects it with a bearer token, but MCP client names
are self-reported and are not cryptographic identities. Reports involving localhost request handling,
token disclosure, consent bypass, STOP bypass, source-boundary escape, redaction ordering, update-feed
integrity, or packaged native dependencies are especially relevant.

The project does not currently offer a bug bounty or guaranteed response deadline.
