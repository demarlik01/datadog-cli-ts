# Architecture

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
│   └── dd-cli.ts           # 엔트리포인트 (#!/usr/bin/env tsx)
├── src/
│   ├── commands/            # 서브커맨드 정의
│   │   ├── logs.ts          # dd-cli logs search
│   │   ├── traces.ts        # dd-cli traces search/get
│   │   ├── events.ts        # dd-cli events list
│   │   └── monitors.ts      # dd-cli monitors list
│   ├── clients/             # Datadog SDK 래퍼
│   │   ├── config.ts        # 인증/설정 초기화
│   │   ├── logs.ts          # LogsApi 래퍼
│   │   ├── spans.ts         # SpansApi 래퍼
│   │   ├── events.ts        # EventsApi 래퍼
│   │   └── monitors.ts      # MonitorsApi 래퍼
│   └── utils/
│       ├── time.ts          # "1h", "24h" → ISO 변환
│       └── errors.ts        # 에러 핸들링
├── docs/
│   └── architecture.md
├── package.json
├── tsconfig.json
└── README.md
```

## 모듈 설계

### Commands Layer (`src/commands/`)

각 리소스별 파일. Commander.js 서브커맨드 정의 + 옵션 파싱 + client 호출 + JSON stdout.

```typescript
// src/commands/logs.ts
import { Command } from "commander";
import { searchLogs } from "../clients/logs";

export const logsCommand = new Command("logs")
  .description("Datadog Logs 조회");

logsCommand
  .command("search")
  .option("--query <query>", "검색 쿼리", "*")
  .option("--from <from>", "시작 시간", "1h")
  .option("--to <to>", "종료 시간", "now")
  .option("--limit <n>", "결과 수", "25")
  .action(async (opts) => {
    const result = await searchLogs(opts);
    console.log(JSON.stringify(result, null, 2));
  });
```

**패턴:** 새 리소스 추가 시 `commands/`, `clients/`에 파일 하나씩 추가 → `bin/dd-cli.ts`에 등록.

### Clients Layer (`src/clients/`)

Datadog SDK를 직접 호출하는 계층. 비즈니스 로직 없이 SDK 호출만.

```typescript
// src/clients/config.ts
import { client } from "@datadog/datadog-api-client";

export function createConfig() {
  const config = client.createConfiguration({
    authMethods: {
      apiKeyAuth: process.env.DD_API_KEY,
      appKeyAuth: process.env.DD_APPLICATION_KEY,
    },
  });

  if (process.env.DD_SITE) {
    client.setServerVariables(config, {
      site: process.env.DD_SITE,
    });
  }

  return config;
}
```

```typescript
// src/clients/spans.ts
import { v2 } from "@datadog/datadog-api-client";
import { createConfig } from "./config";
import { resolveTime } from "../utils/time";

export async function searchSpans(opts: {
  query: string;
  from: string;
  to: string;
  limit: number;
}) {
  const config = createConfig();
  const api = new v2.SpansApi(config);
  const { from, to } = resolveTime(opts.from, opts.to);

  return api.listSpans({
    body: {
      data: {
        attributes: {
          filter: { query: opts.query, from, to },
          sort: "timestamp",
          page: { limit: opts.limit },
        },
        type: "search_request",
      },
    },
  });
}
```

### Utils (`src/utils/`)

**time.ts** — 상대 시간 파싱:
- `"1h"` → `new Date(now - 1hour).toISOString()`
- `"24h"` → `new Date(now - 24hours).toISOString()`
- `"7d"` → `new Date(now - 7days).toISOString()`
- ISO 문자열은 그대로 통과

**errors.ts** — 에러 핸들링:
- SDK 에러 → 읽기 쉬운 메시지로 변환
- 인증 실패 → 환경변수 체크 안내
- stderr 출력, exit code 1

## 인증 흐름

```
1. dd-cli 실행
2. src/clients/config.ts → 환경변수 읽기
   ├── DD_API_KEY (필수)
   ├── DD_APPLICATION_KEY (필수)
   └── DD_SITE (선택, 기본 datadoghq.com)
3. 누락 시 → stderr에 안내 메시지 + exit 1
4. SDK Configuration 생성 → API 호출
```

## 출력 원칙

**JSON only.** 모든 출력은 `JSON.stringify(result, null, 2)`로 stdout.

- 에이전트가 파싱하기 쉬움
- jq로 후처리 가능
- 에러는 stderr, 데이터는 stdout
- exit code로 성공(0)/실패(1) 구분

## 에러 핸들링

| 상황 | 동작 |
|------|------|
| 환경변수 누락 | stderr + exit 1 |
| API 인증 실패 (403) | stderr: "인증 실패. API/App 키를 확인하세요" + exit 1 |
| API 요청 실패 (4xx/5xx) | stderr: 에러 메시지 + HTTP 상태 코드 + exit 1 |
| 네트워크 에러 | stderr: "Datadog API 연결 실패" + exit 1 |
| 결과 없음 | stdout: `[]` + exit 0 (정상) |

## 확장: 새 리소스 추가

1. `src/clients/newresource.ts` — SDK 래퍼 작성
2. `src/commands/newresource.ts` — 서브커맨드 정의
3. `bin/dd-cli.ts`에 `.addCommand()` 추가

3개 파일로 새 리소스 완성. 기존 코드 수정 최소화.
