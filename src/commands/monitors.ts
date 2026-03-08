import { Command } from "commander";
import { listMonitors } from "../clients/monitors";
import { handleError } from "../utils/errors";

export const monitorsCommand = new Command("monitors").description("Datadog Monitors 조회");

monitorsCommand
  .command("list")
  .description("모니터 목록 조회")
  .option("--state <state>", "모니터 상태 필터 (예: alert, warn, no data, ok)")
  .option("--tags <tags>", "쉼표로 구분된 태그 (예: team:backend,env:prod)")
  .action(async (options) => {
    try {
      const result = await listMonitors({
        state: options.state,
        tags: options.tags
      });

      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      handleError(error);
    }
  });
