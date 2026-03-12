# dd-cli

📖 [한국어 문서](./README-ko.md) | 📐 [Architecture](./docs/architecture.md) | 📐 [Architecture (한국어)](./docs/architecture-ko.md)

TypeScript CLI wrapper for the Datadog API. Designed for AI error analysis agents to call from bash.

## Installation

```bash
npm install -g datadog-cli-ts
```

Or build from source:

```bash
git clone https://github.com/demarlik01/datadog-cli-ts.git
cd datadog-cli-ts
pnpm install
pnpm link --global
```

Requires Node.js >= 18.

## Authentication

### OAuth2 (Recommended)

Browser-based OAuth2 authentication. No API Key required.

```bash
# Login (opens browser)
dd-cli auth login

# Specify a different site
dd-cli auth login --site ap1.datadoghq.com

# Check auth status
dd-cli auth status

# Logout (delete tokens)
dd-cli auth logout
```

**How it works:**

1. DCR (Dynamic Client Registration) auto-registers an OAuth client
2. PKCE (S256) + browser authorization
3. Tokens saved to `~/.config/dd-cli/` (file permissions `0600`)
4. Auto-refresh via refresh token on expiry

**Requested scopes** (all read-only):

| Scope | Description |
|-------|-------------|
| `logs_read_data` | Read log data |
| `apm_read` | Read APM data |
| `events_read` | Read events |
| `monitors_read` | Read monitors |
| `dashboards_read` | Read dashboards |
| `metrics_read` | Read metrics |
| `timeseries_query` | Query timeseries |
| `hosts_read` | Read hosts |
| `incident_read` | Read incidents |
| `error_tracking_read` | Read error tracking |

### API Key (Alternative)

Configure API Keys interactively or via options:

```bash
# Interactive setup (prompts for keys)
dd-cli auth configure

# Non-interactive
dd-cli auth configure --api-key <key> --app-key <key> --site datadoghq.com
# ⚠️ CLI flags may be visible in shell history and process listings.
# Use environment variables or interactive prompt for production environments.

# Show current config (keys are masked)
dd-cli auth configure show
```

Keys are stored in `~/.config/dd-cli/config.json` (respects `XDG_CONFIG_HOME`, file permissions `0600`).

You can also set API Keys via environment variables:

```bash
export DD_API_KEY="your-api-key"
export DD_APPLICATION_KEY="your-app-key"
export DD_SITE="datadoghq.com"
```

**Auth priority:** Environment variables > Config file > OAuth tokens > Error

## Usage

```bash
dd-cli <resource> <action> [options]
```

### Logs

```bash
# Search error logs (last 1 hour)
dd-cli logs search --query "service:payment status:error" --from 1h

# Specify time range
dd-cli logs search --query "status:error" --from "2024-03-01T00:00:00Z" --to "2024-03-01T12:00:00Z"

# Limit results
dd-cli logs search --query "status:error" --from 1h --limit 10
```

### Traces

```bash
# Search traces
dd-cli traces search --query "service:api-gateway @http.status_code:500" --from 1h

# Get trace by ID
dd-cli traces get <trace_id>

# Time range + max spans
dd-cli traces get <trace_id> --from 24h --limit 1000
```

### Events

```bash
# List events (last 24 hours)
dd-cli events list --from 24h

# Filter by source
dd-cli events list --from 24h --query "source:alert"
```

### Monitors

```bash
# List monitors in alert state
dd-cli monitors list --state alert

# Filter by tags
dd-cli monitors list --tags "team:backend,env:prod"
```

### Auth

```bash
# OAuth2 login
dd-cli auth login

# Configure API Keys
dd-cli auth configure

# Show config
dd-cli auth configure show

# Check status
dd-cli auth status

# Logout
dd-cli auth logout
```

## Output

All output is JSON to stdout. Pipe to `jq` for processing:

```bash
dd-cli logs search --query "status:error" --from 1h | jq '.data[].attributes.message'
```

### Time Formats

Both relative and absolute time formats are supported:

| Format | Example | Description |
|--------|---------|-------------|
| Relative | `30m`, `1h`, `24h`, `7d`, `2w` | Past from now |
| ISO 8601 | `2024-03-01T00:00:00Z` | Absolute time |
| `now` | `now` | Current time (default) |

Units: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks)

## Stack

- TypeScript + [tsx](https://github.com/privatenumber/tsx) — runs without build step
- [commander.js](https://github.com/tj/commander.js) — CLI framework
- [@datadog/datadog-api-client](https://www.npmjs.com/package/@datadog/datadog-api-client) — official Datadog SDK
- [open](https://www.npmjs.com/package/open) — browser opener for OAuth

## References

- [Datadog API Docs](https://docs.datadoghq.com/api/)
- [Datadog API Client Go](https://github.com/DataDog/datadog-api-client-go) — API structure reference
- [pup CLI](https://github.com/datadog-labs/pup) — DCR client_name reference
