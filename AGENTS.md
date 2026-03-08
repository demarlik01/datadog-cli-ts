# datadog-cli-ts

Datadog API를 래핑하는 TypeScript CLI 도구.
에러 분석 에이전트가 bash에서 호출하는 용도.

## 스택
- TypeScript + tsx
- commander.js (CLI 프레임워크)
- @datadog/datadog-api-client (공식 SDK)

## 구조 원칙
- 서브커맨드 패턴: `dd-cli <resource> <action> [options]`
- JSON 출력 only (stdout), 에러는 stderr
- 환경변수 인증: DD_API_KEY, DD_APPLICATION_KEY, DD_SITE

## MVP 서브커맨드
- `dd-cli logs search --query "..." --from 1h`
- `dd-cli traces search --query "..." --from 1h`
- `dd-cli traces get <trace_id>`
- `dd-cli events list --from 24h`
- `dd-cli monitors list --state alert`
