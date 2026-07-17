# Agent skill installation

ScreenMCP installs its Claude Code and Codex skills during application startup. The application
detects an agent when its normal configuration directory exists or its command is discoverable on
`PATH`. Detection and installation are best-effort; a filesystem or permission failure is logged and
never prevents the capture server from starting.

## Payload and links

Packaged builds read the source files from `resources/skills`; development reads the repository
`skills` directory. ScreenMCP hashes the shared registration helper plus each detected agent's skill
directory, then copies them into:

```text
~/.screenmcp/skill-payloads/<sha256>/
├── shared/register.mjs
├── claude/screenmcp/
└── codex/screenmcp/
```

The content-addressed user copy keeps links valid across application updates, portable builds, moved
installations, and Linux AppImage mount paths. Existing payloads are immutable and reused by hash.

The personal agent directory receives only a directory link named `screenmcp`. Windows uses a
junction, which does not require Developer Mode; macOS and Linux use a directory symlink.

- Claude: `$CLAUDE_CONFIG_DIR/skills/screenmcp`, or `~/.claude/skills/screenmcp`.
- Codex with explicit `CODEX_HOME`: `$CODEX_HOME/skills/screenmcp`.
- Codex otherwise: an existing `~/.agents/skills`, then an existing compatibility
  `~/.codex/skills`; a new installation defaults to `~/.agents/skills`.

## Ownership and updates

ScreenMCP replaces a link only when its resolved target is below
`~/.screenmcp/skill-payloads`. A real file/directory or a link to any other location is a conflict and
is left untouched. Updating creates the new link first, switches from the previous managed link, and
attempts to restore the old target if the switch fails.

Payload directories contain `.screenmcp-skill-payload.json` with their schema and full content hash.
Old hash directories are retained because an agent may still be reading them; their size is small and
they contain only text/scripts from the application bundle.

## Registration

Installing a skill and registering an MCP endpoint are separate. Each installed skill carries a
target-specific `register.mjs` wrapper. It resolves the shared dependency-free helper from the same
payload and reads the current `~/.screenmcp/endpoint.json`. Claude registration invokes its CLI;
Codex registration updates the ScreenMCP block in its `config.toml` atomically.

Key implementation files:

- `app-electron/src/main/skill-installer.ts`
- `app-electron/src/main/index.ts`
- `skills/{claude,codex}/screenmcp/`
- `skills/shared/register.mjs`
