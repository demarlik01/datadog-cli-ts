import { Command } from "commander";
import { listEvents } from "../clients/events";
import { handleError } from "../utils/errors";
import { parsePositiveInt } from "../utils/number";

export const eventsCommand = new Command("events").description("Datadog Events 조회");

eventsCommand
  .command("list")
  .description("이벤트 목록 조회")
  .option("--from <from>", "시작 시간 (예: 24h, 7d)", "24h")
  .option("--to <to>", "종료 시간 (기본: now)", "now")
  .option("--query <query>", "이벤트 필터 쿼리")
  .option("--limit <n>", "결과 수 제한", "25")
  .action(async (options) => {
    try {
      const result = await listEvents({
        from: options.from,
        to: options.to,
        query: options.query,
        limit: parsePositiveInt(options.limit, "--limit")
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      handleError(error);
    }
  });
