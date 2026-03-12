# 아키텍처

## 전체 구조

```
┌─────────────────────────────────────────────┐
│  AI 에러 분석 에이전트                         │
│  (bash에서 dd-cli 호출)                       │
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

## 디렉토리 구조

```
datadog-cli-ts/
├── bin/
│   └── dd-cli.ts              # 엔트리포인트 (#!/usr/bin/env tsx)
├── src/
│   ├── auth/                  # OAuth2 인증
│   │   ├── callback.ts        # OAuth 리다이렉트용 로컬 HTTP 콜백 서버
│   │   ├── dcr.ts             # Dynamic Client Registration
│   │   ├── login.ts           # 로그인 오케스트레이션 (브라우저 기반 OAuth 플로우)
│   │   ├── pkce.ts            # PKCE (S256) 챌린지 생성
│   │   ├── scopes.ts          # OAuth 스코프 정의 (읽기 전용)
│   │   └── token.ts           # 토큰 저장, 갱신, 유효성 검사
│   ├── commands/              # 서브커맨드 정의
│   │   ├── auth.ts            # dd-cli auth login/status/logout/configure
│   │   ├── logs.ts            # dd-cli logs search
│   │   ├── traces.ts          # dd-cli traces search/get
│   │   ├── events.ts          # dd-cli events list
│   │   └── monitors.ts        # dd-cli monitors list
│   ├── clients/               # Datadog SDK 래퍼
│   │   ├── config.ts          # 인증/설정 초기화 + API Key 설정 파일 I/O
│   │   ├── logs.ts            # LogsApi 래퍼
│   │   ├── spans.ts           # SpansApi 래퍼
│   │   ├── events.ts          # EventsApi 래퍼
│   │   └── monitors.ts        # MonitorsApi 래퍼
│   └── utils/
│       ├── time.ts            # 상대 시간 파싱 ("1h", "24h" → ISO)
│       ├── errors.ts          # 에러 핸들링
│       └── number.ts          # 숫자 입력 검증 (parsePositiveInt)
├── docs/
│   ├── architecture.md
│   └── architecture-ko.md
├── package.json
├── tsconfig.json
└── README.md
```

## 모듈 설계

### Commands 레이어 (`src/commands/`)

리소스별 파일 하나. Commander.js 서브커맨드 정의 + 옵션 파싱 + client 호출 + JSON stdout.

**패턴:** 새 리소스를 추가하려면 `commands/`와 `clients/`에 파일 하나씩 생성 후 `bin/dd-cli.ts`에서 `.addCommand()`로 등록.

### Clients 레이어 (`src/clients/`)

Datadog SDK를 감싸는 얇은 래퍼. 비즈니스 로직 없이 SDK 호출만 수행.

**`config.ts`**가 중앙 설정 모듈:

```typescript
export async function createConfig(): Promise<client.Configuration> {
  // 1. 환경변수 (DD_API_KEY + DD_APPLICATION_KEY)
  // 2. 설정 파일 (~/.config/dd-cli/config.json)
  // 3. OAuth 토큰 (~/.config/dd-cli/tokens_{site}.json)
  // 4. 에러 메시지와 안내
}
```

`loadApiKeyConfig()`, `saveApiKeyConfig()`, `getConfigFilePaths()`도 제공하여 `auth configure` 커맨드에서 사용.

### Auth 레이어 (`src/auth/`)

OAuth2 DCR (Dynamic Client Registration) + PKCE (S256) 방식을 구현.

#### 인증 우선순위

```
1. 환경변수 (DD_API_KEY + DD_APPLICATION_KEY) → API Key 인증
2. 설정 파일 (~/.config/dd-cli/config.json)   → API Key 인증 (영구 저장)
3. OAuth 토큰 (~/.config/dd-cli/tokens_{site}.json) → OAuth2 인증 (자동 갱신)
4. 없음 → 에러 메시지와 안내
```

#### `auth configure` 커맨드

API Key 인증 정보를 설정 파일에 저장하여 환경변수 없이 사용 가능.

```
dd-cli auth configure                              # 인터랙티브 (키 입력 프롬프트)
dd-cli auth configure --api-key X --app-key Y      # 비대화형
dd-cli auth configure show                         # 현재 설정 표시 (키 마스킹)
```

- 설정 파일: `$XDG_CONFIG_HOME/dd-cli/config.json` (기본 `~/.config/dd-cli/config.json`)
- 파일 권한: `0o600`
- 저장 필드: `api_key`, `app_key`, `site`

#### OAuth2 플로우

```
┌──────────────┐                          ┌──────────────┐
│   dd-cli     │                          │  Datadog     │
│              │  1. DCR (클라이언트 등록)   │  OAuth2      │
│              │─────────────────────────→│  Server      │
│              │  client_id               │              │
│              │←─────────────────────────│              │
│              │                          │              │
│              │  2. 브라우저 열기          │              │
│   ┌──────┐  │     (authorize URL       │              │
│   │PKCE  │  │      + code_challenge)   │              │
│   │S256  │  │─────────────────────────→│              │
│   └──────┘  │                          │              │
│              │  3. 사용자 인가           │              │
│              │                          │              │
│  ┌────────┐ │  4. 콜백 (code 포함)      │              │
│  │Local   │←│─────────────────────────│              │
│  │:8000   │ │                          │              │
│  └────────┘ │  5. 코드 교환             │              │
│              │     + code_verifier     │              │
│              │─────────────────────────→│              │
│              │  access + refresh token  │              │
│              │←─────────────────────────│              │
│              │                          │              │
│              │  6. 토큰 저장            │              │
│              │  ~/.config/dd-cli/       │              │
└──────────────┘                          └──────────────┘
```

#### DCR (Dynamic Client Registration)

- 엔드포인트: `https://api.{site}/api/v2/oauth2/register`
- `client_name`: `"datadog-api-claude-plugin"` (정확히 일치해야 함. [pup CLI](https://github.com/datadog-labs/pup)와 동일)
- Grant types: `authorization_code`, `refresh_token`
- 등록된 클라이언트는 `~/.config/dd-cli/client_{site}.json`에 캐싱

#### PKCE (S256)

- Verifier: 128자 랜덤 `base64url` 문자열
- Challenge: verifier의 SHA-256 해시, `base64url` 인코딩
- Method: `S256`

#### 로컬 콜백 서버

- 포트 순서대로 시도: `8000`, `8080`, `8888`, `9000`
- 경로: `/oauth/callback`
- `state` 파라미터 검증 (CSRF 보호)
- 타임아웃: 5분

#### OAuth 스코프 (읽기 전용)

```
logs_read_data       apm_read             events_read
monitors_read        dashboards_read      metrics_read
timeseries_query     hosts_read           incident_read
error_tracking_read
```

총 10개 스코프, 모두 읽기 전용. 쓰기 작업은 수행하지 않음.

#### 토큰 및 설정 저장

| 파일 | 경로 | 내용 |
|------|------|------|
| API Key 설정 | `~/.config/dd-cli/config.json` | `api_key`, `app_key`, `site` |
| OAuth 토큰 | `~/.config/dd-cli/tokens_{site}.json` | `access_token`, `refresh_token`, `expires_in`, `issued_at`, `scope` |
| OAuth 클라이언트 | `~/.config/dd-cli/client_{site}.json` | `client_id`, `client_name`, `redirect_uris`, `registered_at` |

- 모든 파일은 `XDG_CONFIG_HOME`을 존중 (기본값 `~/.config`)
- 파일 권한: `0o600` (소유자만 읽기/쓰기)
- 디렉토리 권한: `0o700`
- 사이트명은 sanitize 처리 (`.` → `_`): 예) `tokens_datadoghq_com.json`

#### 토큰 자동 갱신

- 실제 만료 5분 전에 만료된 것으로 판단 (300초 버퍼)
- `getValidAccessToken()`이 만료 시 자동으로 `refreshToken()` 호출
- 갱신된 토큰은 디스크에 다시 저장
- 갱신 실패 시 `dd-cli auth login`으로 재로그인 필요

### Utils (`src/utils/`)

**time.ts** — 상대 시간 파싱:
- `"30m"` → `new Date(now - 30분).toISOString()`
- 지원 단위: `s` (초), `m` (분), `h` (시간), `d` (일), `w` (주)
- ISO 문자열은 그대로 통과
- `"now"` → 현재 시간

**errors.ts** — 에러 핸들링:
- SDK 에러 → 읽기 쉬운 메시지로 변환
- 인증 실패 (401/403) → 인증 정보 확인 안내
- 네트워크 에러 → 연결 상태 확인 안내
- stderr 출력, exit code 1

**number.ts** — 숫자 입력 검증:
- `parsePositiveInt(input, name)` — 양의 정수 검증

## 출력 원칙

**JSON only.** 데이터 명령은 `JSON.stringify(result, null, 2)`로 stdout 출력. Auth 명령은 compact JSON (`JSON.stringify(obj)`) 사용.

- 에이전트가 파싱하기 쉬움
- jq로 후처리 가능
- 에러는 stderr, 데이터는 stdout
- exit code로 성공(0)/실패(1) 구분

## 에러 핸들링

| 상황 | 동작 |
|------|------|
| 인증 정보 없음 | stderr: 안내 메시지 + exit 1 |
| API 인증 실패 (401/403) | stderr: "API/App 키를 확인하세요" + exit 1 |
| API 요청 실패 (4xx/5xx) | stderr: 에러 메시지 + HTTP 상태 코드 + exit 1 |
| 네트워크 에러 | stderr: "연결 실패" + exit 1 |
| 결과 없음 | stdout: `[]` + exit 0 (정상) |

## 확장: 새 리소스 추가

1. `src/clients/newresource.ts` — SDK 래퍼 작성 (`await createConfig()` 사용)
2. `src/commands/newresource.ts` — 서브커맨드 정의
3. `bin/dd-cli.ts` — `.addCommand()`로 등록

3개 파일로 새 리소스 완성. 기존 코드 수정 최소화.
