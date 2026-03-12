# datadog-cli-ts

Datadog API를 래핑하는 TypeScript CLI. AI 에러 분석 에이전트가 bash에서 호출하는 용도로 설계.

## 설치

```bash
pnpm install
pnpm link --global  # 'dd-cli' 명령어로 사용
```

## 인증

### OAuth2 (권장)

브라우저 기반 OAuth2 인증. API Key 없이 사용 가능.

```bash
# 로그인 (브라우저가 열림)
dd-cli auth login

# 다른 사이트 지정
dd-cli auth login --site ap1.datadoghq.com

# 인증 상태 확인
dd-cli auth status

# 로그아웃 (토큰 삭제)
dd-cli auth logout
```

**동작 방식:**
1. DCR (Dynamic Client Registration)로 OAuth 클라이언트 자동 등록
2. PKCE (S256) + 브라우저 인증
3. 토큰을 `~/.config/dd-cli/`에 저장 (파일 권한 `0600`)
4. 만료 시 refresh token으로 자동 갱신

**요청되는 스코프** (모두 읽기 전용):

| 스코프 | 설명 |
|--------|------|
| `logs_read_data` | 로그 데이터 읽기 |
| `apm_read` | APM 데이터 읽기 |
| `events_read` | 이벤트 읽기 |
| `monitors_read` | 모니터 읽기 |
| `dashboards_read` | 대시보드 읽기 |
| `metrics_read` | 메트릭 읽기 |
| `timeseries_query` | 타임시리즈 쿼리 |
| `hosts_read` | 호스트 읽기 |
| `incident_read` | 인시던트 읽기 |
| `error_tracking_read` | 에러 트래킹 읽기 |

### API Key (대안)

환경변수로 API Key를 직접 설정. OAuth2보다 우선 적용됨.

```bash
export DD_API_KEY="your-api-key"
export DD_APPLICATION_KEY="your-app-key"
export DD_SITE="datadoghq.com"        # ap1.datadoghq.com 등 (선택)
```

> **인증 우선순위:** 환경변수(API Key) > OAuth 토큰 > 에러

## 사용법

```bash
dd-cli <resource> <action> [options]
```

### Logs

```bash
# 에러 로그 검색 (최근 1시간)
dd-cli logs search --query "service:payment status:error" --from 1h

# 시간 범위 지정
dd-cli logs search --query "status:error" --from "2024-03-01T00:00:00Z" --to "2024-03-01T12:00:00Z"

# 결과 수 제한
dd-cli logs search --query "status:error" --from 1h --limit 10
```

### Traces

```bash
# 트레이스 검색
dd-cli traces search --query "service:api-gateway @http.status_code:500" --from 1h

# 특정 trace ID로 상세 조회
dd-cli traces get <trace_id>

# 시간 범위 + 최대 span 수
dd-cli traces get <trace_id> --from 24h --limit 1000
```

### Events

```bash
# 최근 24시간 이벤트
dd-cli events list --from 24h

# 알림 이벤트만
dd-cli events list --from 24h --query "source:alert"
```

### Monitors

```bash
# Alert 상태인 모니터만
dd-cli monitors list --state alert

# 태그 필터
dd-cli monitors list --tags "team:backend,env:prod"
```

### Auth

```bash
# OAuth2 로그인
dd-cli auth login

# 인증 상태 확인
dd-cli auth status

# 로그아웃
dd-cli auth logout
```

## 출력

모든 출력은 JSON. jq로 가공 가능.

```bash
dd-cli logs search --query "status:error" --from 1h | jq '.data[].attributes.message'
```

## 시간 형식

상대 시간과 절대 시간 모두 지원:

| 형식 | 예시 | 설명 |
|------|------|------|
| 상대 시간 | `30m`, `1h`, `24h`, `7d`, `2w` | 현재부터 과거로 |
| ISO 8601 | `2024-03-01T00:00:00Z` | 절대 시간 |
| `now` | `now` | 현재 시간 (기본값) |

단위: `s` (초), `m` (분), `h` (시간), `d` (일), `w` (주)

## 스택

- TypeScript + [tsx](https://github.com/privatenumber/tsx) (빌드 없이 실행)
- [commander.js](https://github.com/tj/commander.js) (CLI 프레임워크)
- [@datadog/datadog-api-client](https://www.npmjs.com/package/@datadog/datadog-api-client) (공식 SDK)
- [open](https://www.npmjs.com/package/open) (브라우저 열기, OAuth 인증용)

## 아키텍처

자세한 구조는 [docs/architecture.md](docs/architecture.md) (English) 또는 [docs/architecture-ko.md](docs/architecture-ko.md) (한국어) 참조.

## 레퍼런스

- [Datadog API Docs](https://docs.datadoghq.com/api/)
- [Datadog API Client Go](https://github.com/DataDog/datadog-api-client-go) — API 구조 참고
- [pup CLI](https://github.com/datadog-labs/pup) — DCR client_name 참조
