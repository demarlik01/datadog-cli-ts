import { Command } from "commander";
import { logsCommand } from "../src/commands/logs";
import { tracesCommand } from "../src/commands/traces";
import { eventsCommand } from "../src/commands/events";
import { monitorsCommand } from "../src/commands/monitors";
import { authCommand } from "../src/commands/auth";
import { handleError } from "../src/utils/errors";

const program = new Command();

program
  .name("dd-cli")
  .description("Datadog API를 래핑하는 TypeScript CLI")
  .showHelpAfterError();

program.addCommand(logsCommand);
program.addCommand(tracesCommand);
program.addCommand(eventsCommand);
program.addCommand(monitorsCommand);
program.addCommand(authCommand);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    handleError(error);
  }
}

main();
