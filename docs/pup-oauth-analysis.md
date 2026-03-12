# Pup OAuth2 DCR 분석

> 소스: https://github.com/datadog-labs/pup (Rust, not Go)
> 분석일: 2026-03-12

## 1. DCR 엔드포인트 URL

```
POST https://api.{site}/api/v2/oauth2/register
```

- `site` 기본값: `datadoghq.com`
- 따라서 기본 URL: **`https://api.datadoghq.com/api/v2/oauth2/register`**
- `DD_SITE` 환경변수 또는 config로 변경 가능

> ⚠️ dd-cli에서 404가 나는 이유: pup도 같은 URL을 사용한다. DCR 엔드포인트가 아직 public으로 열려있지 않거나, 특정 조건(org 설정, 피쳐 플래그 등)이 필요할 수 있음. pup이 Datadog 내부 도구라 내부 API에 접근 가능한 것일 수 있음.

**소스:** `src/auth/dcr.rs` → `DcrClient::register()`

```rust
let url = format!("https://api.{}/api/v2/oauth2/register", self.site);
```

## 2. DCR 요청 바디

```json
{
  "client_name": "datadog-api-claude-plugin",
  "redirect_uris": ["http://127.0.0.1:{port}/oauth/callback"],
  "grant_types": ["authorization_code", "refresh_token"]
}
```

### 필드 상세:
| 필드 | 값 | 비고 |
|------|-----|------|
| `client_name` | `"datadog-api-claude-plugin"` | 상수 `DCR_CLIENT_NAME` |
| `redirect_uris` | `["http://127.0.0.1:{port}/oauth/callback"]` | 포트: 8000, 8080, 8888, 9000 중 사용 가능한 것 |
| `grant_types` | `["authorization_code", "refresh_token"]` | |

### 빠진 필드 (RFC 7591 선택):
- `response_types` → **보내지 않음**
- `token_endpoint_auth_method` → **보내지 않음** (서버 기본값 사용)
- `scope` → 함수 시그니처에 `_scopes` 파라미터 있지만 **실제로 사용하지 않음** (언더스코어 prefix)

**소스:** `src/auth/dcr.rs` → `RegistrationRequest` struct

```rust
#[derive(Serialize)]
struct RegistrationRequest {
    client_name: String,
    redirect_uris: Vec<String>,
    grant_types: Vec<String>,
}
```

## 3. DCR 응답

기대하는 응답 (HTTP 201 Created):

```json
{
  "client_id": "...",
  "client_name": "...",
  "redirect_uris": [...]
}
```

> **주목: `client_secret`가 응답에 없다!** `RegistrationResponse`에 `client_secret` 필드가 없음. Public client (PKCE 기반)으로 동작.

```rust
#[derive(Deserialize)]
struct RegistrationResponse {
    client_id: String,
    client_name: String,
    redirect_uris: Vec<String>,
}
```

## 4. Client Credentials 저장

두 가지 스토리지 백엔드 (자동 감지):

### A. OS Keychain (기본, 우선)
- service name: `"pup"`
- 키: `client_{sanitized_site}` (예: `client_datadoghq_com`)
- `keyring` crate 사용

### B. File Storage (keychain 불가 시 fallback)
- 경로: `~/.config/pup/client_{sanitized_site}.json`
- 퍼미션: `0o600`
- `DD_TOKEN_STORAGE=file` 환경변수로 강제 가능

### 저장 포맷 (ClientCredentials):
```json
{
  "client_id": "...",
  "client_name": "datadog-api-claude-plugin",
  "redirect_uris": ["http://127.0.0.1:8000/oauth/callback"],
  "registered_at": 1710259200,
  "site": "datadoghq.com"
}
```

> Client credentials는 **site 단위**로 공유됨 (org 별이 아님). 이미 등록된 client가 있으면 재사용.

## 5. Token Endpoint URL

```
POST https://api.{site}/oauth2/v1/token
```

- 기본: **`https://api.datadoghq.com/oauth2/v1/token`**
- Content-Type: `application/x-www-form-urlencoded` (`.form()` 사용)

### Authorization Code Exchange 파라미터:
```
grant_type=authorization_code
client_id={client_id}
code={authorization_code}
redirect_uri={redirect_uri}
code_verifier={pkce_verifier}
```

### Refresh Token 파라미터:
```
grant_type=refresh_token
client_id={client_id}
refresh_token={refresh_token}
```

> **주목:** `client_secret`을 token exchange에서도 보내지 않음. Public client + PKCE 방식 확인.

**소스:** `src/auth/dcr.rs` → `DcrClient::request_tokens()`

## 6. Authorization URL

```
https://app.{site}/oauth2/v1/authorize?{params}
```

- 기본: **`https://app.datadoghq.com/oauth2/v1/authorize`**
- **`app.` 서브도메인** 사용 (API가 아닌 웹 UI)

### Query Parameters:
| 파라미터 | 값 |
|---------|-----|
| `response_type` | `code` |
| `client_id` | DCR에서 받은 client_id |
| `redirect_uri` | `http://127.0.0.1:{port}/oauth/callback` |
| `state` | 32자 랜덤 문자열 (CSRF 방지) |
| `scope` | 스페이스로 구분된 scope 목록 |
| `code_challenge` | PKCE S256 challenge |
| `code_challenge_method` | `S256` |

**소스:** `src/auth/dcr.rs` → `DcrClient::build_authorization_url()`

## 7. Scope 목록

총 **70개** 기본 스코프. 주요 카테고리별:

### APM
- `apm_read`, `apm_service_catalog_read`

### Audit
- `audit_logs_read`

### Cases
- `cases_read`, `cases_write`

### CI/CD
- `ci_visibility_read`, `code_coverage_read`, `dora_metrics_write`, `test_optimization_read`, `test_optimization_write`

### Dashboards
- `dashboards_read`, `dashboards_write`

### Events
- `events_read`

### Hosts
- `hosts_read`, `host_tags_write`

### Incidents
- `incident_read`, `incident_write`, `incident_notification_settings_read`, `incident_settings_read`, `incident_settings_write`

### Integrations
- `integrations_read`, `manage_integrations`

### Logs
- `logs_generate_metrics`, `logs_modify_indexes`, `logs_read_archives`, `logs_read_config`, `logs_read_data`, `logs_read_index_data`, `logs_write_archives`

### Metrics
- `metrics_read`

### Monitors
- `monitors_read`, `monitors_write`, `monitors_downtime`

### Notebooks
- `notebooks_read`, `notebooks_write`

### OCI
- `oci_configuration_edit`, `oci_configuration_read`, `oci_configurations_manage`

### Organizations
- `org_management`

### RUM
- `rum_apps_read`, `rum_apps_write`, `rum_generate_metrics`, `rum_retention_filters_read`, `rum_retention_filters_write`, `rum_session_replay_read`

### Security
- `security_monitoring_filters_read`, `security_monitoring_filters_write`, `security_monitoring_findings_read`, `security_monitoring_rules_read`, `security_monitoring_rules_write`, `security_monitoring_signals_read`

### SLOs
- `slos_read`, `slos_write`

### Status Pages
- `status_pages_settings_read`, `status_pages_settings_write`

### Synthetics
- `synthetics_read`, `synthetics_write`, `synthetics_private_location_read`

### Teams
- `teams_manage`, `teams_read`

### Others
- `azure_configuration_read`, `bits_investigations_read`, `bits_investigations_write`, `data_scanner_read`, `error_tracking_read`, `disaster_recovery_status_read`, `disaster_recovery_status_write`, `timeseries_query`, `usage_read`, `user_access_read`

### Read-Only 모드
`--read-only` 플래그 시 write/manage 스코프 제외한 39개 스코프만 요청.

**소스:** `src/auth/types.rs` → `default_scopes()`, `read_only_scopes()`

## 8. 전체 OAuth 플로우 요약

```
1. 로컬 콜백 서버 시작 (포트 8000/8080/8888/9000)
2. 기존 client credentials 확인 (keychain/file)
   └─ 없으면 DCR로 새 client 등록
3. PKCE challenge 생성 (S256, verifier 128자)
4. 브라우저로 authorization URL 열기
5. 사용자 인증 → 콜백으로 authorization code 수신 (timeout 5분)
6. code + PKCE verifier로 token 교환
7. tokens 저장 (access_token, refresh_token)
```

## 9. dd-cli-ts 구현 시 핵심 포인트

1. **Public Client**: `client_secret` 없음. PKCE (S256) 필수.
2. **DCR 엔드포인트가 404**: 이 엔드포인트는 아직 public이 아닐 수 있음. 대안:
   - Datadog OAuth App을 수동으로 등록하고 client_id를 하드코딩
   - 또는 Datadog 지원팀에 DCR 활성화 문의
3. **URL 패턴**:
   - DCR: `https://api.{site}/api/v2/oauth2/register`
   - Token: `https://api.{site}/oauth2/v1/token`
   - Authorize: `https://app.{site}/oauth2/v1/authorize`
4. **Token 저장**: keychain 우선, file fallback (`~/.config/pup/`)
5. **Scope**: 최소 권한 원칙 적용 가능 (read-only 모드 지원)
