# Datadog CLI 구축 방법 리서치 리포트

> 작성일: 2026-03-08
> 목표: 에러 분석 에이전트가 bash에서 호출할 수 있는 Datadog CLI 도구 만들기

---

## 요약 (TL;DR)

**Pup CLI를 쓰면 된다.** 직접 만들 필요 없음.

Datadog이 공식적으로 AI 에이전트용 CLI인 **Pup**을 만들어놨다. Rust 기반, 300+ 서브커맨드, JSON/YAML 출력 지원. 우리가 필요한 logs search, events, monitors, error-tracking이 모두 구현되어 있다. Traces/Spans만 아직 미구현이지만, 이건 REST API curl로 보완 가능.

---

## 1. 공식 Datadog CLI 도구들

### 1.1 Pup CLI ⭐ (최우선 추천)

- **저장소**: https://github.com/datadog-labs/pup
- **상태**: Preview (활발 개발 중)
- **언어**: Rust
- **설치**: `brew tap datadog-labs/pack && brew install datadog-labs/pack/pup` 또는 `go install` 또는 바이너리 다운로드
- **인증**: OAuth2 + PKCE (브라우저 로그인) 또는 API Key/App Key 환경변수

#### 지원 기능 (우리에게 필요한 것 위주)

| 기능 | Pup 지원 | 명령어 예시 |
|------|----------|------------|
| **Logs 검색** | ✅ | `pup logs search --query="status:error" --from="1h"` |
| **Logs 집계** | ✅ | `pup logs aggregate` |
| **Events 조회** | ✅ | `pup events list`, `events search`, `events get` |
| **Monitors 조회** | ✅ | `pup monitors list --tags="team:api"`, `monitors get` |
| **Error Tracking** | ✅ | `pup error-tracking issues search`, `issues get` |
| **APM Services** | ✅ | `pup apm services`, `apm entities`, `apm dependencies` |
| **Metrics 조회** | ✅ | `pup metrics query --query="avg:system.cpu.user{*}"` |
| **Incidents** | ✅ | `pup incidents list`, `incidents get` |
| **Dashboards** | ✅ | `pup dashboards list`, `dashboards get` |
| **SLOs** | ✅ | `pup slos list`, `slos status` |
| **Traces/Spans** | ❌ | 미구현 (REST API로 보완) |

#### 장점
- **바로 쓸 수 있음** — 설치하고 인증하면 끝
- **JSON/YAML/Table 출력** — jq로 파싱하기 완벽
- **AI 에이전트용으로 설계됨** — self-discoverable 커맨드
- **300+ 서브커맨드** across 42 커맨드 그룹
- **유지보수 부담 제로** — Datadog이 관리

#### 단점
- Preview 상태 (안정성 리스크 있으나 활발히 개발 중)
- Traces/Spans API 미구현
- 일부 도메인 미구현 (Profiling, Session Replay 등)

### 1.2 Dogshell (레거시)

- **설치**: `pip install datadog` → `dog` 명령어 사용
- **공식 문서**: https://docs.datadoghq.com/developers/guide/dogshell/
- **기능**: metrics post, events, monitors, dashboards
- **한계**: Logs 검색 미지원, API v2 미지원, 오래된 도구
- **결론**: ❌ 우리 용도에 부적합

### 1.3 datadog-ci

- **용도**: CI/CD 전용 (테스트 결과 업로드, 소스맵 업로드 등)
- **결론**: ❌ 범용 조회 CLI 아님

---

## 2. SDK로 직접 CLI 만들기 (필요시 대안)

Pup이 커버하지 못하는 Traces/Spans 같은 경우를 위한 옵션.

### 2.1 datadog-api-client-go

- **저장소**: https://github.com/DataDog/datadog-api-client-go
- **커버리지**: Datadog API 전체 (auto-generated from OpenAPI spec)
- **장점**: 단일 바이너리 빌드, 크로스 컴파일 용이
- **단점**: Go 환경 필요, 코드 작성 필요

#### 예시: Spans 검색 (Go)

```go
package main

import (
    "context"
    "fmt"
    "github.com/DataDog/datadog-api-client-go/v2/api/datadog"
    "github.com/DataDog/datadog-api-client-go/v2/api/datadogV2"
)

func main() {
    ctx := datadog.NewDefaultContext(context.Background())
    configuration := datadog.NewConfiguration()
    apiClient := datadog.NewAPIClient(configuration)
    api := datadogV2.NewSpansApi(apiClient)

    body := datadogV2.SpansListRequest{
        Data: &datadogV2.SpansListRequestData{
            Attributes: &datadogV2.SpansListRequestAttributes{
                Filter: &datadogV2.SpansQueryFilter{
                    Query: datadog.PtrString("@trace_id:1234567890"),
                    From:  datadog.PtrString("now-1h"),
                    To:    datadog.PtrString("now"),
                },
            },
            Type: datadogV2.SPANSLISTREQUESTTYPE_SEARCH_REQUEST.Ptr(),
        },
    }

    resp, _, err := api.ListSpans(ctx, body)
    if err != nil {
        fmt.Printf("Error: %v\n", err)
        return
    }
    // JSON 출력 처리
}
```

### 2.2 다른 언어 SDK 비교

| 언어 | SDK | CLI 적합도 | 이유 |
|------|-----|-----------|------|
| **Go** | datadog-api-client-go | ⭐⭐⭐⭐⭐ | 단일 바이너리, 크로스 컴파일, 빠름 |
| **Python** | datadog-api-client-python | ⭐⭐⭐ | 쉽게 작성 가능하나 런타임 의존성 |
| **Rust** | (Pup이 이미 Rust) | ⭐⭐⭐⭐ | 성능 최고, 빌드 복잡 |
| **TypeScript** | datadog-api-client-typescript | ⭐⭐ | Node.js 런타임 필요 |
| **Java** | datadog-api-client-java | ⭐ | JVM 무거움, CLI에 부적합 |

**결론**: Go가 CLI 래퍼 만들기에 가장 적합하지만, Pup이 이미 있으므로 직접 만들 이유가 거의 없음.

---

## 3. REST API 직접 호출 (curl)

Pup이 미지원하는 Traces/Spans 조회를 위한 보조 수단.

### 3.1 인증

```bash
export DD_API_KEY="your-api-key"
export DD_APPLICATION_KEY="your-app-key"
export DD_SITE="datadoghq.com"  # 또는 ap1.datadoghq.com 등
```

헤더:
- `DD-API-KEY: ${DD_API_KEY}`
- `DD-APPLICATION-KEY: ${DD_APPLICATION_KEY}`

### 3.2 주요 엔드포인트

#### Logs 검색 (POST /api/v2/logs/events/search)
```bash
curl -X POST "https://api.${DD_SITE}/api/v2/logs/events/search" \
  -H "Content-Type: application/json" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APPLICATION_KEY}" \
  -d '{
    "filter": {
      "query": "service:my-service status:error",
      "from": "now-1h",
      "to": "now"
    },
    "sort": "-timestamp",
    "page": { "limit": 25 }
  }'
```

#### Spans/Traces 검색 (POST /api/v2/spans/events/search)
```bash
curl -X POST "https://api.${DD_SITE}/api/v2/spans/events/search" \
  -H "Content-Type: application/json" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APPLICATION_KEY}" \
  -d '{
    "data": {
      "attributes": {
        "filter": {
          "query": "@trace_id:1234567890987654321",
          "from": "now-1h",
          "to": "now"
        }
      },
      "type": "search_request"
    }
  }'
```

#### Events 조회 (GET /api/v2/events)
```bash
curl -X GET "https://api.${DD_SITE}/api/v2/events?filter[from]=now-24h&filter[to]=now&filter[query]=source:alert" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APPLICATION_KEY}"
```

#### Monitors 조회 (GET /api/v1/monitor)
```bash
curl -X GET "https://api.${DD_SITE}/api/v1/monitor?tags=team:backend" \
  -H "DD-API-KEY: ${DD_API_KEY}" \
  -H "DD-APPLICATION-KEY: ${DD_APPLICATION_KEY}"
```

### 3.3 장단점

| 장점 | 단점 |
|------|------|
| 의존성 제로 (curl만 있으면 됨) | 매번 긴 명령어 작성 |
| 모든 API 엔드포인트 접근 가능 | 페이지네이션 직접 처리 필요 |
| 디버깅 쉬움 | 에러 핸들링 수동 |

---

## 4. 기존 서드파티 도구

조사 결과 쓸만한 서드파티 도구는 거의 없음:

- **dogshell** (공식, 레거시) — 위에서 설명. logs 미지원.
- **zorkian/go-datadog-api** — 비공식 Go 라이브러리. 오래됨, v1 API 위주. datadog-api-client-go에 대체됨.
- **datadog-sync-cli** — 리소스 동기화 전용. 조회용 아님.

**결론**: 쓸만한 서드파티 없음. Pup이 압도적.

---

## 5. 필요 기능 매핑 및 구현 전략

| 기능 | Pup CLI | curl 보완 | 우선순위 |
|------|---------|-----------|----------|
| Logs 검색 (쿼리, 시간범위, 필터) | ✅ `pup logs search` | 불필요 | 필수 |
| Error Tracking 이슈 조회 | ✅ `pup error-tracking issues search` | 불필요 | 필수 |
| Monitors 조회 (트리거된 알림) | ✅ `pup monitors list` | 불필요 | 필수 |
| Events 조회 | ✅ `pup events list/search` | 불필요 | 필수 |
| APM 서비스 정보 | ✅ `pup apm services` | 불필요 | 높음 |
| Traces/Spans 조회 | ❌ | ✅ curl wrapper 필요 | 높음 |
| Incidents 조회 | ✅ `pup incidents list` | 불필요 | 중간 |
| Metrics 조회 | ✅ `pup metrics query` | 불필요 | 낮음 |

---

## 6. 최종 추천안

### 추천: Pup CLI + Traces용 쉘 래퍼

```
[에러 분석 에이전트]
    ├── pup CLI (메인) ── logs, events, monitors, error-tracking, apm, incidents
    └── dd-traces.sh (보조) ── traces/spans 조회 (curl 래퍼)
```

#### 구현 계획

**Step 1: Pup CLI 설치 및 인증 설정**
```bash
brew tap datadog-labs/pack
brew install datadog-labs/pack/pup

# 헤드리스 환경 (서버)에서는 API Key 인증
export DD_API_KEY="..."
export DD_APPLICATION_KEY="..."
export DD_SITE="datadoghq.com"

# 또는 로컬에서 OAuth 로그인
pup auth login
```

**Step 2: Traces/Spans 조회용 쉘 래퍼 만들기**
```bash
#!/bin/bash
# dd-traces.sh - Pup이 미지원하는 traces/spans 조회

search_spans() {
  local query="$1"
  local from="${2:-now-1h}"
  local to="${3:-now}"
  
  curl -s -X POST "https://api.${DD_SITE:-datadoghq.com}/api/v2/spans/events/search" \
    -H "Content-Type: application/json" \
    -H "DD-API-KEY: ${DD_API_KEY}" \
    -H "DD-APPLICATION-KEY: ${DD_APPLICATION_KEY}" \
    -d "{
      \"data\": {
        \"attributes\": {
          \"filter\": {
            \"query\": \"${query}\",
            \"from\": \"${from}\",
            \"to\": \"${to}\"
          },
          \"sort\": \"-timestamp\",
          \"page\": { \"limit\": 50 }
        },
        \"type\": \"search_request\"
      }
    }"
}

get_trace() {
  local trace_id="$1"
  search_spans "@trace_id:${trace_id}" "now-24h" "now"
}

# Usage
case "$1" in
  search) search_spans "$2" "$3" "$4" ;;
  get)    get_trace "$2" ;;
  *)      echo "Usage: dd-traces.sh {search|get} [args...]" ;;
esac
```

**Step 3: 에이전트에서 사용**
```bash
# Logs에서 에러 찾기
pup logs search --query="service:payment status:error" --from="1h" --format=json | jq '.data[].attributes.message'

# Error tracking 이슈 조회
pup error-tracking issues search --query="is:unresolved"

# 트리거된 모니터 확인
pup monitors list --tags="team:backend" --format=json | jq '.[] | select(.overall_state == "Alert")'

# Trace 상세 조회 (보조 스크립트)
./dd-traces.sh get 1234567890987654321 | jq '.data[].attributes'
```

### 왜 이 조합인가?

| 기준 | Pup CLI + curl | Go 자체 구축 | Python 스크립트 | curl만 |
|------|---------------|-------------|---------------|--------|
| **구현 시간** | 1시간 | 2-3일 | 1일 | 2시간 |
| **유지보수** | Datadog이 해줌 | 우리가 함 | 우리가 함 | 수동 |
| **기능 커버리지** | 95%+ | 100% | 100% | 100% |
| **안정성** | Preview(리스크 있음) | 우리 통제 | 우리 통제 | 안정 |
| **바이너리 배포** | brew/binary | 빌드 필요 | 런타임 필요 | 없음 |
| **AI 에이전트 친화** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |

**Pup이 압도적으로 유리.** Preview 상태가 유일한 리스크지만, Datadog 공식 프로젝트이고 활발히 개발 중이라 실용성 충분.

Pup이 나중에 Traces 지원하면 curl 래퍼도 제거 가능 → 장기적으로 유지보수 부담 0.

---

## 부록: Pup CLI 헤드리스 인증 (서버 환경)

서버/CI에서 OAuth 대신 API Key 인증:

```bash
# .env 또는 환경변수 설정
export DD_API_KEY="your-api-key"
export DD_APPLICATION_KEY="your-app-key" 
export DD_SITE="datadoghq.com"

# 바로 사용 가능 (OAuth 로그인 불필요)
pup monitors list
```

Pup은 환경변수에 API Key가 있으면 자동으로 API Key 인증을 사용한다.
