# datadog-cli-ts

Datadog API를 래핑하는 TypeScript CLI. AI 에러 분석 에이전트가 bash에서 호출하는 용도로 설계.

## 설치

```bash
pnpm install
pnpm link --global  # 'dd-cli' 명령어로 사용
```

## 환경변수

```bash
export DD_API_KEY="your-api-key"
export DD_APPLICATION_KEY="your-app-key"
export DD_SITE="datadoghq.com"        # ap1.datadoghq.com 등
```

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

## 출력

모든 출력은 JSON. jq로 가공 가능.

```bash
dd-cli logs search --query "status:error" --from 1h | jq '.data[].attributes.message'
```

## 스택

- TypeScript + [tsx](https://github.com/privatenumber/tsx) (빌드 없이 실행)
- [commander.js](https://github.com/tj/commander.js) (CLI 프레임워크)
- [@datadog/datadog-api-client](https://www.npmjs.com/package/@datadog/datadog-api-client) (공식 SDK)

## 레퍼런스

- [Datadog API Client Go](https://github.com/DataDog/datadog-api-client-go) — API 구조 참고
- [Datadog API Docs](https://docs.datadoghq.com/api/)
