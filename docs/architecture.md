# Architecture

## Overview

```
┌─────────────────────────────────────────────┐
│  AI Error Analysis Agent                     │
│  (calls dd-cli from bash)                    │
└──────────────┬──────────────────────────────┘
               │ exec: dd-cli logs search ...
               ▼
┌─────────────────────────────────────────────┐
│  dd-cli (TypeScript)                        │
│  ┌─────────┐ ┌──────────┐ ┌─────────────┐  │
│  │Commander│→│ Commands  │→│   Clients   │  │
│  │ (parse) │ │ (validate)│ │ (SDK calls) │  │
│  └─────────┘ └──────────┘ └──────┬──────┘  │
│                                   │         │
│                      ┌────────────┴───┐     │
│                      │  Auth (OAuth2  │     │
│                      │  / API Key)    │     │
│                      └────────────────┘     │
│                                   │         │
│                            ┌──────┴──────┐  │
│                            │  JSON stdout│  │
│                            └─────────────┘  │
└─────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  Datadog API                                │
│  api.datadoghq.com                          │
└─────────────────────────────────────────────┘
```

## Directory Structure

```
datadog-cli-ts/
├── bin/
│   └── dd-cli.ts              # Entrypoint (built via tsup → dist/dd-cli.js)
├── src/
│   ├── auth/                  # OAuth2 authentication
│   │   ├── callback.ts        # Local HTTP callback server for OAuth redirect
│   │   ├── dcr.ts             # Dynamic Client Registration
│   │   ├── login.ts           # Login orchestration (browser-based OAuth flow)
│   │   ├── pkce.ts            # PKCE (S256) challenge generation
│   │   ├── scopes.ts          # OAuth scope definitions (read-only)
│   │   └── token.ts           # Token storage, refresh, and validation
│   ├── commands/              # Subcommand definitions
│   │   ├── auth.ts            # dd-cli auth login/status/logout/configure
│   │   ├── logs.ts            # dd-cli logs search
│   │   ├── traces.ts          # dd-cli traces search/get
│   │   ├── events.ts          # dd-cli events list
│   │   └── monitors.ts        # dd-cli monitors list
│   ├── clients/               # Datadog SDK wrappers
│   │   ├── config.ts          # Auth/config initialization + API Key config file I/O
│   │   ├── logs.ts            # LogsApi wrapper
│   │   ├── spans.ts           # SpansApi wrapper
│   │   ├── events.ts          # EventsApi wrapper
│   │   └── monitors.ts        # MonitorsApi wrapper
│   └── utils/
│       ├── time.ts            # Relative time parsing ("1h", "24h" → ISO)
│       ├── errors.ts          # Error handling
│       └── number.ts          # Numeric input validation (parsePositiveInt)
├── docs/
│   ├── architecture.md
│   └── architecture-ko.md
├── package.json
├── tsconfig.json
└── README.md
```

## Module Design

### Commands Layer (`src/commands/`)

One file per resource. Defines Commander.js subcommands + option parsing + client calls + JSON stdout.

**Pattern:** To add a new resource, create one file each in `commands/` and `clients/`, then register with `.addCommand()` in `bin/dd-cli.ts`.

### Clients Layer (`src/clients/`)

Thin wrappers around the Datadog SDK. No business logic — just SDK calls.

**`config.ts`** is the central configuration module:

```typescript
export async function createConfig(): Promise<client.Configuration> {
  // 1. Environment variables (DD_API_KEY + DD_APPLICATION_KEY)
  // 2. Config file (~/.config/dd-cli/config.json)
  // 3. OAuth tokens (~/.config/dd-cli/tokens_{site}.json)
  // 4. Error with guidance
}
```

It also provides `loadApiKeyConfig()`, `saveApiKeyConfig()`, and `getConfigFilePaths()` for the `auth configure` command.

### Auth Layer (`src/auth/`)

Implements OAuth2 with DCR (Dynamic Client Registration) + PKCE (S256).

#### Authentication Priority

```
1. Environment variables (DD_API_KEY + DD_APPLICATION_KEY) → API Key auth
2. Config file (~/.config/dd-cli/config.json)              → API Key auth (persisted)
3. OAuth tokens (~/.config/dd-cli/tokens_{site}.json)      → OAuth2 auth (auto-refresh)
4. None available                                          → Error with guidance
```

#### `auth configure` Command

Saves API Key credentials to a config file for persistent, non-environment-variable auth.

```
dd-cli auth configure                              # Interactive (prompts for keys)
dd-cli auth configure --api-key X --app-key Y      # Non-interactive
dd-cli auth configure show                         # Display current config (keys masked)
```

- Config file: `$XDG_CONFIG_HOME/dd-cli/config.json` (defaults to `~/.config/dd-cli/config.json`)
- File permissions: `0o600`
- Stored fields: `api_key`, `app_key`, `site`

#### OAuth2 Flow

```
┌──────────────┐                          ┌──────────────┐
│   dd-cli     │                          │  Datadog     │
│              │  1. DCR (register)       │  OAuth2      │
│              │─────────────────────────→│  Server      │
│              │  client_id               │              │
│              │←─────────────────────────│              │
│              │                          │              │
│              │  2. Open browser         │              │
│   ┌──────┐  │     (authorize URL       │              │
│   │PKCE  │  │      + code_challenge)   │              │
│   │S256  │  │─────────────────────────→│              │
│   └──────┘  │                          │              │
│              │  3. User authorizes      │              │
│              │                          │              │
│  ┌────────┐ │  4. Callback with code   │              │
│  │Local   │←│─────────────────────────│              │
│  │:8000   │ │                          │              │
│  └────────┘ │  5. Exchange code        │              │
│              │     + code_verifier     │              │
│              │─────────────────────────→│              │
│              │  access + refresh token  │              │
│              │←─────────────────────────│              │
│              │                          │              │
│              │  6. Save tokens          │              │
│              │  ~/.config/dd-cli/       │              │
└──────────────┘                          └──────────────┘
```

#### DCR (Dynamic Client Registration)

- Endpoint: `https://api.{site}/api/v2/oauth2/register`
- `client_name`: `"datadog-api-claude-plugin"` (must match exactly; same as [pup CLI](https://github.com/datadog-labs/pup))
- Grant types: `authorization_code`, `refresh_token`
- Registered client is cached at `~/.config/dd-cli/client_{site}.json`

#### PKCE (S256)

- Verifier: 128-char random `base64url` string
- Challenge: SHA-256 hash of verifier, `base64url`-encoded
- Method: `S256`

#### Local Callback Server

- Tries ports in order: `8000`, `8080`, `8888`, `9000`
- Path: `/oauth/callback`
- Validates `state` parameter (CSRF protection)
- Timeout: 5 minutes

#### OAuth Scopes (Read-Only)

```
logs_read_data       apm_read             events_read
monitors_read        dashboards_read      metrics_read
timeseries_query     hosts_read           incident_read
error_tracking_read
```

All 10 scopes are read-only. No write operations are performed.

#### Token & Config Storage

| File | Path | Content |
|------|------|---------|
| API Key Config | `~/.config/dd-cli/config.json` | `api_key`, `app_key`, `site` |
| OAuth Tokens | `~/.config/dd-cli/tokens_{site}.json` | `access_token`, `refresh_token`, `expires_in`, `issued_at`, `scope` |
| OAuth Client | `~/.config/dd-cli/client_{site}.json` | `client_id`, `client_name`, `redirect_uris`, `registered_at` |

- All files respect `XDG_CONFIG_HOME` (defaults to `~/.config`)
- File permissions: `0o600` (owner read/write only)
- Directory permissions: `0o700`
- Site name is sanitized (`.` → `_`): e.g., `tokens_datadoghq_com.json`

#### Token Auto-Refresh

- Tokens are considered expired 5 minutes before actual expiry (300s buffer)
- `getValidAccessToken()` automatically calls `refreshToken()` when expired
- Refreshed tokens are saved back to disk
- If refresh fails, user must re-login with `dd-cli auth login`

### Utils (`src/utils/`)

**time.ts** — Relative time parsing:
- `"30m"` → `new Date(now - 30min).toISOString()`
- Supports: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks)
- ISO strings pass through as-is
- `"now"` → current time

**errors.ts** — Error handling:
- SDK errors → human-readable messages
- Auth failures (401/403) → credential check guidance
- Network errors → connection check guidance
- stderr output, exit code 1

**number.ts** — Numeric input validation:
- `parsePositiveInt(input, name)` — validates that input is a positive integer

## Output Principles

**JSON only.** Data commands output `JSON.stringify(result, null, 2)` to stdout. Auth commands use compact JSON (`JSON.stringify(obj)`).

- Easy for agents to parse
- Composable with `jq`
- Errors go to stderr, data to stdout
- Exit codes: success (0) / failure (1)

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No credentials | stderr: guidance message + exit 1 |
| API auth failure (401/403) | stderr: "Check API/App keys" + exit 1 |
| API request failure (4xx/5xx) | stderr: error message + HTTP status + exit 1 |
| Network error | stderr: "Connection failed" + exit 1 |
| No results | stdout: `[]` + exit 0 (normal) |

## Extending: Adding a New Resource

1. `src/clients/newresource.ts` — SDK wrapper (use `await createConfig()`)
2. `src/commands/newresource.ts` — Subcommand definition
3. `bin/dd-cli.ts` — Register with `.addCommand()`

Three files for a new resource. Minimal changes to existing code.
