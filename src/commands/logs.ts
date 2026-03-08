import { Command } from "commander";
import { searchLogs } from "../clients/logs";
import { handleError } from "../utils/errors";
import { parsePositiveInt } from "../utils/number";

export const logsCommand = new Command("logs").description("Datadog Logs 조회");

logsCommand
  .command("search")
  .description("로그 검색")
  .option("--query <query>", "검색 쿼리", "*")
  .option("--from <from>", "시작 시간 (예: 1h, 24h, 2024-03-01T00:00:00Z)", "1h")
  .option("--to <to>", "종료 시간 (기본: now)", "now")
  .option("--limit <n>", "결과 수 제한", "25")
  .action(async (options) => {
    try {
      const result = await searchLogs({
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
