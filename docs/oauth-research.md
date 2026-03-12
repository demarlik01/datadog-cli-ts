# Datadog OAuth2 인증 리서치 리포트

> 작성일: 2026-03-08
> 목적: TypeScript CLI에서 Datadog OAuth2 인증 구현 방법 조사

## 1. 핵심 요약

Datadog은 **Dynamic Client Registration (DCR) + Authorization Code + PKCE** 방식의 OAuth2를 지원한다. CLI 도구에서는 사전에 OAuth App을 등록할 필요 없이, 런타임에 DCR로 client_id를 자동 발급받고 PKCE 기반 인증을 수행할 수 있다. 이 방식은 Datadog의 Pup CLI와 MCP 서버에서 이미 프로덕션으로 사용 중이다.

**API Key 없이 OAuth2 토큰만으로 Datadog API를 사용할 수 있다.** OAuth 토큰은 scope에 따라 logs, traces, events, monitors, dashboards 등 거의 모든 API에 접근 가능하다.

---

## 2. Datadog OAuth2 아키텍처

### 2.1 엔드포인트

| 용도 | URL | 메서드 |
|------|-----|--------|
| Dynamic Client Registration | `https://api.{site}/api/v2/oauth2/register` | POST |
| Authorization (브라우저) | `https://app.{site}/oauth2/v1/authorize` | GET (redirect) |
| Token Exchange / Refresh | `https://api.{site}/oauth2/v1/token` | POST |

`{site}`는 Datadog 사이트에 따라 달라짐:
- US1: `datadoghq.com` (기본값)
- EU1: `datadoghq.eu`
- US3: `us3.datadoghq.com`
- US5: `us5.datadoghq.com`
- AP1: `ap1.datadoghq.com`

### 2.2 인증 흐름 (Authorization Code + PKCE + DCR)

```
CLI                                          Datadog OAuth
 │                                                │
 │ 1. POST /api/v2/oauth2/register (DCR)         │
 │───────────────────────────────────────────────>│
 │<───────────────────────────────────────────────│
 │    { client_id, client_name, redirect_uris }   │
 │                                                │
 │ 2. Generate PKCE (code_verifier → SHA256 → challenge)
 │ 3. Generate state (CSRF protection)            │
 │ 4. Start local HTTP server (127.0.0.1:PORT)    │
 │                                                │
 │ 5. Open browser → /oauth2/v1/authorize         │
 │    ?response_type=code                         │
 │    &client_id=xxx                              │
 │    &redirect_uri=http://127.0.0.1:PORT/callback│
 │    &state=xxx                                  │
 │    &scope=logs_read_data monitors_read ...     │
 │    &code_challenge=xxx                         │
 │    &code_challenge_method=S256                 │
 │───────────────────────────────────────────────>│
 │                                                │
 │ 6. 사용자가 브라우저에서 scope 승인             │
 │                                                │
 │ 7. Redirect → http://127.0.0.1:PORT/callback   │
 │    ?code=AUTH_CODE&state=xxx                    │
 │<───────────────────────────────────────────────│
 │                                                │
 │ 8. POST /oauth2/v1/token                       │
 │    grant_type=authorization_code               │
 │    &client_id=xxx                              │
 │    &code=AUTH_CODE                              │
 │    &redirect_uri=http://127.0.0.1:PORT/callback│
 │    &code_verifier=xxx                          │
 │───────────────────────────────────────────────>│
 │<───────────────────────────────────────────────│
 │    { access_token, refresh_token, expires_in }  │
 │                                                │
 │ 9. 토큰 로컬 저장 (0600 퍼미션)               │
```

---

## 3. Dynamic Client Registration (DCR) 상세

### 3.1 개인 등록 가능 여부

**DCR은 관리자 권한 없이 개인이 직접 호출할 수 있다.** Pup CLI의 구현을 보면, 별도의 인증 없이 DCR 엔드포인트에 POST 요청을 보내 client_id를 발급받는다. 이는 RFC 7591 기반의 오픈 등록 방식이다.

> ⚠️ 단, Datadog Developer Platform에서 수동으로 OAuth App을 등록하는 방식(Marketplace 통합용)과는 별개다. DCR은 CLI 같은 네이티브 앱을 위한 자동 등록 메커니즘이다.

### 3.2 DCR 요청 형식

```typescript
// POST https://api.datadoghq.com/api/v2/oauth2/register
const body = {
  client_name: "my-datadog-cli",  // 앱 이름
  redirect_uris: ["http://127.0.0.1:8000/oauth/callback"],
  grant_types: ["authorization_code", "refresh_token"],
};
```

### 3.3 DCR 응답

```typescript
// HTTP 201 Created
{
  client_id: "abc123...",
  client_name: "my-datadog-cli",
  redirect_uris: ["http://127.0.0.1:8000/oauth/callback"]
}
```

**주의사항:**
- Pup은 `client_secret`를 DCR 응답에서 받지 않는다 (응답 구조체에 `client_secret` 필드가 없음)
- `token_endpoint_auth_method`는 문서에는 `client_secret_post`로 언급되나, 실제 Pup 코드에서는 client_id만으로 토큰 교환을 수행
- 이는 사실상 **Public Client** 방식

### 3.4 Redirect URI 포트 전략

Pup은 고정 포트 목록에서 사용 가능한 포트를 찾는 방식을 사용:

```typescript
const REDIRECT_PORTS = [8000, 8080, 8888, 9000];
```

DCR 시 실제 바인딩할 포트의 redirect_uri를 등록한다.

---

## 4. Public Client vs Confidential Client

### CLI에는 Public Client가 적합

| 항목 | Public Client | Confidential Client |
|------|--------------|-------------------|
| client_secret | 없음 (또는 비공개 불가) | 서버에 안전하게 저장 |
| 적합한 앱 | CLI, 모바일, SPA | 서버 사이드 앱 |
| PKCE 필수 | ✅ 필수 | 권장 |
| Datadog DCR | ✅ 지원 | ✅ 지원 |

Pup CLI의 실제 구현을 보면:
- DCR 응답에 `client_secret`이 없음 (RegistrationResponse에 필드 없음)
- 토큰 교환 시 `client_id`만 사용
- PKCE가 실질적인 보안 계층

→ **TypeScript CLI도 Public Client + PKCE로 구현하면 된다.**

---

## 5. 토큰 관리

### 5.1 토큰 만료 정책

| 토큰 유형 | 유효기간 |
|----------|---------|
| Access Token | **1시간** (3600초) |
| Refresh Token | **30일** |

### 5.2 자동 갱신 전략

```typescript
// 5분 버퍼를 두고 만료 체크
function isExpired(token: TokenSet): boolean {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = token.issued_at + token.expires_in;
  return now >= (expiresAt - 300); // 5분 전부터 만료로 간주
}

// API 호출 전 자동 갱신
async function getValidToken(): Promise<string> {
  let tokens = loadTokens();
  if (isExpired(tokens)) {
    tokens = await refreshToken(tokens.refresh_token);
    saveTokens(tokens);
  }
  return tokens.access_token;
}
```

### 5.3 토큰 저장

```
~/.config/my-dd-cli/
├── client_{site}.json      # DCR 클라이언트 정보
└── tokens_{site}.json      # 액세스/리프레시 토큰
```

- 파일 퍼미션: `0600` (owner만 읽기/쓰기)
- 사이트별 별도 저장 (멀티사이트 지원)
- macOS Keychain 연동도 가능 (Pup은 keyring crate 사용)

---

## 6. OAuth Scope 목록

### 6.1 주요 Scope (CLI 도구에 필요한 것들)

```typescript
const ESSENTIAL_SCOPES = [
  // Logs
  "logs_read_data",
  "logs_read_index_data",
  
  // APM / Traces  
  "apm_read",
  
  // Events
  "events_read",
  
  // Monitors
  "monitors_read",
  "monitors_write",        // 모니터 수정 필요시
  "monitors_downtime",     // 다운타임 관리
  
  // Dashboards
  "dashboards_read",
  "dashboards_write",      // 대시보드 수정 필요시
  
  // Metrics
  "metrics_read",
  "timeseries_query",      // 메트릭 쿼리
  
  // Hosts
  "hosts_read",
  
  // Incidents
  "incident_read",
  
  // User
  "user_access_read",
];
```

### 6.2 Pup CLI 전체 Scope 목록 (70개)

Pup은 기본적으로 70개의 scope을 요청한다. 읽기 전용 모드(`--read-only`)에서는 write/manage scope를 제외한 서브셋을 사용.

카테고리별 주요 scope:
- **APM**: `apm_read`, `apm_service_catalog_read`
- **Audit**: `audit_logs_read`
- **Cases**: `cases_read`, `cases_write`
- **CI**: `ci_visibility_read`, `code_coverage_read`
- **Dashboards**: `dashboards_read`, `dashboards_write`
- **Error Tracking**: `error_tracking_read`
- **Events**: `events_read`
- **Hosts**: `hosts_read`, `host_tags_write`
- **Incidents**: `incident_read`, `incident_write`
- **Integrations**: `integrations_read`, `manage_integrations`
- **Logs**: `logs_read_data`, `logs_read_index_data`, `logs_read_config`, `logs_generate_metrics`, `logs_modify_indexes`, `logs_read_archives`, `logs_write_archives`
- **Metrics**: `metrics_read`
- **Monitors**: `monitors_read`, `monitors_write`, `monitors_downtime`
- **Notebooks**: `notebooks_read`, `notebooks_write`
- **Org**: `org_management`
- **RUM**: `rum_apps_read`, `rum_apps_write`
- **Security**: `security_monitoring_signals_read`, `security_monitoring_rules_read`, `security_monitoring_findings_read`
- **SLOs**: `slos_read`, `slos_write`
- **Synthetics**: `synthetics_read`, `synthetics_write`
- **Teams**: `teams_read`, `teams_manage`
- **Timeseries**: `timeseries_query`
- **Usage**: `usage_read`
- **Users**: `user_access_read`

### 6.3 Scope 전략 권장사항

1. **필요한 scope만 요청** — 사용자에게 consent 화면에서 너무 많은 권한을 보여주면 거부할 수 있음
2. **read-only 모드 분리** — 조회 전용 CLI 사용 시 write scope 제외
3. **점진적 scope 확장** — 나중에 기능 추가 시 재인증으로 scope 확대 가능

---

## 7. Datadog MCP 서버 분석

### 7.1 공식 Datadog MCP 서버

- URL: `https://mcp.datadoghq.com/sse`
- 인증: OAuth2 (remote authentication)
- 이 서버는 Datadog이 직접 호스팅하는 원격 MCP 서버
- 클라이언트(Claude Code, Cursor 등)가 연결하면 OAuth2 인증을 통해 사용자 Datadog 계정에 접근

### 7.2 MCP 서버의 OAuth 구현

MCP 프로토콜의 OAuth 인증은 MCP 클라이언트(Claude Code 등)가 처리한다. 서버 측에서는:
- 표준 OAuth2 Authorization Code + PKCE 흐름 사용
- DCR 엔드포인트를 통해 클라이언트 등록 자동화
- 토큰으로 사용자의 Datadog 데이터에 접근

### 7.3 커스텀 CLI에서의 시사점

Datadog MCP 서버가 OAuth2로 잘 동작한다는 것은, **동일한 OAuth2 인프라를 커스텀 CLI에서도 활용할 수 있다**는 의미. DCR + PKCE 흐름을 직접 구현하면 된다.

---

## 8. TypeScript 구현 가이드

### 8.1 의존성

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "open": "^10.0.0"    // 브라우저 열기
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

> `express`는 불필요. Node.js 내장 `http` 모듈로 콜백 서버 구현 가능.

### 8.2 핵심 구현 코드

#### PKCE 생성

```typescript
import crypto from 'node:crypto';

interface PkceChallenge {
  verifier: string;
  challenge: string;
  method: 'S256';
}

function generatePkce(): PkceChallenge {
  // 128자 랜덤 문자열 (base64url)
  const verifier = crypto.randomBytes(96).toString('base64url').slice(0, 128);
  
  // SHA256 해시 → base64url
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');
  
  return { verifier, challenge, method: 'S256' };
}

function generateState(): string {
  return crypto.randomBytes(24).toString('base64url').slice(0, 32);
}
```

#### DCR (Dynamic Client Registration)

```typescript
interface ClientCredentials {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  registered_at: number;
  site: string;
}

async function registerClient(
  site: string, 
  redirectUri: string
): Promise<ClientCredentials> {
  const url = `https://api.${site}/api/v2/oauth2/register`;
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'my-datadog-cli',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });
  
  if (resp.status !== 201) {
    const body = await resp.text();
    throw new Error(`DCR failed (${resp.status}): ${body}`);
  }
  
  const data = await resp.json();
  return {
    client_id: data.client_id,
    client_name: data.client_name,
    redirect_uris: data.redirect_uris,
    registered_at: Math.floor(Date.now() / 1000),
    site,
  };
}
```

#### 로컬 콜백 서버

```typescript
import http from 'node:http';
import { URL } from 'node:url';

interface CallbackResult {
  code: string;
  state: string;
  error?: string;
}

function startCallbackServer(port: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth callback timeout (5분)'));
    }, 5 * 60 * 1000);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://127.0.0.1:${port}`);
      
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get('code') || '';
      const state = url.searchParams.get('state') || '';
      const error = url.searchParams.get('error') || undefined;

      // 성공/실패 HTML 응답
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(error 
        ? `<h1>인증 실패</h1><p>${error}</p>` 
        : '<h1>인증 성공!</h1><p>이 창을 닫아도 됩니다.</p>'
      );

      clearTimeout(timeout);
      server.close();
      resolve({ code, state, error });
    });

    server.listen(port, '127.0.0.1');
  });
}
```

#### 토큰 교환

```typescript
interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  issued_at: number;
  scope: string;
  client_id: string;
}

async function exchangeCode(
  site: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
): Promise<TokenSet> {
  const url = `https://api.${site}/oauth2/v1/token`;
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  return {
    ...data,
    issued_at: Math.floor(Date.now() / 1000),
    client_id: clientId,
  };
}
```

#### 토큰 갱신

```typescript
async function refreshAccessToken(
  site: string,
  refreshToken: string,
  clientId: string,
): Promise<TokenSet> {
  const url = `https://api.${site}/oauth2/v1/token`;
  
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed (${resp.status})`);
  }

  const data = await resp.json();
  return {
    ...data,
    issued_at: Math.floor(Date.now() / 1000),
    client_id: clientId,
  };
}
```

#### 토큰 저장/로드

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function getConfigDir(): string {
  const dir = path.join(os.homedir(), '.config', 'my-dd-cli');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeSite(site: string): string {
  return site.replace(/\./g, '_');
}

function saveTokens(site: string, tokens: TokenSet): void {
  const filePath = path.join(getConfigDir(), `tokens_${sanitizeSite(site)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2));
  fs.chmodSync(filePath, 0o600);
}

function loadTokens(site: string): TokenSet | null {
  const filePath = path.join(getConfigDir(), `tokens_${sanitizeSite(site)}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveClientCredentials(site: string, creds: ClientCredentials): void {
  const filePath = path.join(getConfigDir(), `client_${sanitizeSite(site)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2));
  fs.chmodSync(filePath, 0o600);
}

function loadClientCredentials(site: string): ClientCredentials | null {
  const filePath = path.join(getConfigDir(), `client_${sanitizeSite(site)}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
```

#### 전체 로그인 플로우

```typescript
import open from 'open';

const REDIRECT_PORTS = [8000, 8080, 8888, 9000];
const DEFAULT_SITE = 'datadoghq.com';

async function login(site: string = DEFAULT_SITE, scopes: string[]): Promise<void> {
  // 1. 사용 가능한 포트 찾기
  const port = await findAvailablePort(REDIRECT_PORTS);
  const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  
  // 2. DCR (이미 등록된 클라이언트가 있으면 재사용)
  let creds = loadClientCredentials(site);
  if (!creds) {
    console.log('🔑 새 OAuth 클라이언트 등록 중...');
    creds = await registerClient(site, redirectUri);
    saveClientCredentials(site, creds);
  }
  
  // 3. PKCE + State 생성
  const pkce = generatePkce();
  const state = generateState();
  
  // 4. 콜백 서버 시작 (비동기)
  const callbackPromise = startCallbackServer(port);
  
  // 5. 브라우저 열기
  const scope = scopes.join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.client_id,
    redirect_uri: redirectUri,
    state,
    scope,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  });
  const authUrl = `https://app.${site}/oauth2/v1/authorize?${params}`;
  
  console.log('🌐 브라우저에서 Datadog 인증 페이지를 엽니다...');
  await open(authUrl);
  console.log(`\n자동으로 열리지 않으면 이 URL을 직접 열어주세요:\n${authUrl}\n`);
  
  // 6. 콜백 대기
  const result = await callbackPromise;
  
  // 7. State 검증 (CSRF 방지)
  if (result.state !== state) {
    throw new Error('State mismatch - CSRF 보호 위반');
  }
  if (result.error) {
    throw new Error(`인증 실패: ${result.error}`);
  }
  
  // 8. 토큰 교환
  console.log('🔄 토큰 교환 중...');
  const tokens = await exchangeCode(site, result.code, redirectUri, pkce.verifier, creds.client_id);
  
  // 9. 저장
  saveTokens(site, tokens);
  console.log('✅ 인증 완료!');
}
```

#### API 호출 시 토큰 사용

```typescript
async function datadogFetch(site: string, apiPath: string): Promise<any> {
  let tokens = loadTokens(site);
  if (!tokens) {
    throw new Error('인증되지 않음. `dd-cli auth login`을 실행하세요.');
  }
  
  // 자동 갱신
  if (isExpired(tokens)) {
    console.log('🔄 토큰 갱신 중...');
    try {
      tokens = await refreshAccessToken(site, tokens.refresh_token, tokens.client_id);
      saveTokens(site, tokens);
    } catch {
      throw new Error('토큰 갱신 실패. `dd-cli auth login`으로 재인증하세요.');
    }
  }
  
  const resp = await fetch(`https://api.${site}${apiPath}`, {
    headers: {
      'Authorization': `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  
  return resp.json();
}
```

### 8.3 Commander.js 통합 예시

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('dd-cli')
  .description('Datadog CLI Tool');

// Auth 서브커맨드
const auth = program.command('auth');

auth
  .command('login')
  .option('--site <site>', 'Datadog site', 'datadoghq.com')
  .option('--read-only', 'Request read-only scopes')
  .action(async (opts) => {
    const scopes = opts.readOnly ? READ_ONLY_SCOPES : DEFAULT_SCOPES;
    await login(opts.site, scopes);
  });

auth
  .command('status')
  .action(async () => {
    const tokens = loadTokens(site);
    if (!tokens) {
      console.log('❌ 인증되지 않음');
      return;
    }
    console.log(`✅ 인증됨 (만료: ${isExpired(tokens) ? '만료됨' : '유효'})`);
  });

auth
  .command('logout')
  .action(async () => {
    deleteTokens(site);
    deleteClientCredentials(site);
    console.log('✅ 로그아웃 완료');
  });

// 실제 기능 커맨드 
program
  .command('logs')
  .option('--query <query>', 'Log query')
  .action(async (opts) => {
    const data = await datadogFetch(site, '/api/v2/logs/events/search');
    console.log(data);
  });
```

---

## 9. 핵심 질문 답변

### Q1: OAuth App을 개인이 등록할 수 있는가?

**DCR 방식: Yes.** DCR 엔드포인트(`/api/v2/oauth2/register`)에 인증 없이 POST하면 자동으로 client_id가 발급된다. 관리자 권한이 필요 없다.

**Developer Platform 방식: 조건부.** Datadog Developer Platform에서 수동으로 OAuth App을 만드는 것은 Marketplace 통합 배포용으로, 이 경우 조직 관리자 승인이 필요할 수 있다. CLI용으로는 DCR이 적합하다.

### Q2: Public Client vs Confidential Client?

**CLI에는 Public Client가 적합.** Pup CLI의 실제 구현도 `client_secret` 없이 `client_id`만 사용한다. PKCE가 보안을 보장.

### Q3: Refresh Token 만료 정책?

- Access Token: **1시간** (3600초)
- Refresh Token: **30일**
- Refresh Token 만료 시 사용자에게 재로그인 요청

### Q4: OAuth 토큰으로 모든 API 접근 가능한가?

**Yes.** OAuth 토큰은 API Key + Application Key 조합과 동등한 접근 권한을 가진다. scope에 따라 접근 범위가 결정된다.

접근 가능한 API들:
- ✅ Logs (logs_read_data)
- ✅ Traces/APM (apm_read)
- ✅ Events (events_read)
- ✅ Monitors (monitors_read/write)
- ✅ Dashboards (dashboards_read/write)
- ✅ Metrics (metrics_read, timeseries_query)
- ✅ Hosts (hosts_read)
- ✅ Incidents (incident_read/write)
- ✅ SLOs (slos_read/write)
- ✅ Synthetics (synthetics_read/write)
- ✅ 기타 (security, RUM, notebooks, teams 등)

### Q5: Scope는 뭘 요청해야 하는가?

CLI의 용도에 따라 다르지만, **최소 권한 원칙** 추천:

**조회 전용 CLI (추천 시작점):**
```
logs_read_data logs_read_index_data apm_read events_read 
monitors_read dashboards_read metrics_read timeseries_query 
hosts_read incident_read slos_read user_access_read
```

**읽기+쓰기 CLI:**
위 scope + `monitors_write dashboards_write monitors_downtime incident_write slos_write`

---

## 10. Pup CLI 참고 구현 (Rust → TypeScript 매핑)

| Pup (Rust) | TypeScript 등가 |
|------------|-----------------|
| `src/auth/dcr.rs` | DCR 클라이언트 등록 + 토큰 교환 |
| `src/auth/pkce.rs` | `crypto.randomBytes` + `crypto.createHash` |
| `src/auth/callback.rs` | `http.createServer` 로컬 콜백 |
| `src/auth/storage.rs` | `fs` 기반 JSON 파일 저장 |
| `src/auth/types.rs` | TypeScript 인터페이스 정의 |
| `keyring` crate | `keytar` npm (선택) |

---

## 11. 구현 체크리스트

- [ ] PKCE 생성 (code_verifier 128자, SHA256 → base64url)
- [ ] DCR 클라이언트 등록 (`/api/v2/oauth2/register`)
- [ ] 로컬 HTTP 콜백 서버 (127.0.0.1, 포트 풀)
- [ ] 브라우저 열기 (`open` 패키지)
- [ ] Authorization Code 수신 + State 검증
- [ ] 토큰 교환 (`/oauth2/v1/token`)
- [ ] 토큰 저장 (파일, 0600 퍼미션)
- [ ] 자동 토큰 갱신 (5분 버퍼)
- [ ] `auth login` / `auth status` / `auth logout` / `auth refresh` 커맨드
- [ ] API 호출 시 `Authorization: Bearer <token>` 헤더
- [ ] 멀티사이트 지원 (DD_SITE 환경변수)
- [ ] 에러 처리 (타임아웃, 토큰 만료, 네트워크 오류)

---

## 12. 참고 자료

- **RFC 6749**: OAuth 2.0 Authorization Framework
- **RFC 7591**: OAuth 2.0 Dynamic Client Registration Protocol
- **RFC 7636**: Proof Key for Code Exchange (PKCE)
- **Pup CLI**: https://github.com/datadog-labs/pup (Rust 구현체, OAuth2 참조)
- **Datadog OAuth2 Docs**: https://docs.datadoghq.com/developers/authorization/oauth2_in_datadog/
- **Datadog OAuth2 Endpoints**: https://docs.datadoghq.com/developers/authorization/oauth2_endpoints/
- **Datadog Scopes**: https://docs.datadoghq.com/api/latest/scopes/
- **Datadog MCP Server**: https://docs.datadoghq.com/bits_ai/mcp_server/
