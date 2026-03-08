import { Command } from "commander";
import { searchSpans } from "../clients/spans";
import { handleError } from "../utils/errors";
import { parsePositiveInt } from "../utils/number";

export const tracesCommand = new Command("traces").description("Datadog Traces 조회");

tracesCommand
  .command("search")
  .description("트레이스(span) 검색")
  .option("--query <query>", "검색 쿼리", "*")
  .option("--from <from>", "시작 시간 (예: 1h, 24h, 2024-03-01T00:00:00Z)", "1h")
  .option("--to <to>", "종료 시간 (기본: now)", "now")
  .option("--limit <n>", "결과 수 제한", "25")
  .action(async (options) => {
    try {
      const result = await searchSpans({
        query: options.query,
        from: options.from,
        to: options.to,
        limit: parsePositiveInt(options.limit, "--limit")
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      handleError(error);
    }
  });

tracesCommand
  .command("get")
  .description("Trace ID로 조회")
  .argument("<trace_id>", "조회할 trace ID")
  .option("--from <from>", "시작 시간 (기본: 24h)", "24h")
  .option("--to <to>", "종료 시간 (기본: now)", "now")
  .option("--limit <n>", "최대 span 수", "1000")
  .action(async (traceId: string, options) => {
    try {
      const result = await searchSpans({
        query: `trace_id:${traceId}`,
        from: options.from,
        to: options.to,
        limit: parsePositiveInt(options.limit, "--limit")
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      handleError(error);
    }
  });
