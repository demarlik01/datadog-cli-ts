import { Command } from "commander";
import * as readline from "node:readline/promises";
import { login } from "../auth/login.js";
import {
  loadTokens,
  loadClient,
  deleteTokens,
  deleteClient,
  isExpired,
} from "../auth/token.js";
import {
  loadApiKeyConfig,
  saveApiKeyConfig,
  getConfigFilePaths,
  getAuthSource,
} from "../clients/config.js";
import { handleError } from "../utils/errors.js";

/**
 * Read a line from stdin with input hidden (replaced with asterisks).
 * Falls back to regular readline if stdin is not a TTY.
 */
function readPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Non-TTY: fall back to regular readline
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      rl.question(prompt).then((answer) => {
        rl.close();
        resolve(answer);
      }, reject);
      return;
    }

    process.stderr.write(prompt);
    const buf: Buffer[] = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onData = (ch: string): void => {
      const code = ch.charCodeAt(0);
      if (ch === "\r" || ch === "\n" || code === 4 /* EOF */) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        resolve(Buffer.concat(buf).toString("utf-8"));
      } else if (code === 3 /* Ctrl-C */) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        reject(new Error("User cancelled"));
      } else if (code === 127 || code === 8 /* Backspace */) {
        if (buf.length > 0) {
          buf.pop();
          process.stderr.write("\b \b");
        }
      } else {
        buf.push(Buffer.from(ch, "utf-8"));
        process.stderr.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}

function getDefaultSite(): string {
  return process.env.DD_SITE ?? "datadoghq.com";
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.slice(0, 4) + "****" + key.slice(-4);
}

export const authCommand = new Command("auth").description(
  "Authentication management",
);

// --- auth login ---
authCommand
  .command("login")
  .description("Login to Datadog via OAuth2")
  .option("--site <site>", "Datadog site", getDefaultSite())
  .action(async (options: { site: string }) => {
    try {
      await login(options.site);
    } catch (error) {
      handleError(error);
    }
  });

// --- auth status ---
authCommand
  .command("status")
  .description("Show authentication status")
  .option("--site <site>", "Datadog site", getDefaultSite())
  .action((options: { site: string }) => {
    try {
      const site = options.site;
      const activeSource = getAuthSource(site);

      // Check env vars
      const hasEnv = Boolean(process.env.DD_API_KEY && process.env.DD_APPLICATION_KEY);

      // Check config file
      const fileConfig = loadApiKeyConfig();

      // Check OAuth tokens
      const tokens = loadTokens(site);
      const clientCreds = loadClient(site);

      // Show active auth source prominently
      const result: Record<string, unknown> = {
        active_source: activeSource,
      };

      if (hasEnv) {
        result.env_vars = {
          status: "configured",
          method: "api_key",
          site: process.env.DD_SITE ?? "datadoghq.com",
          api_key: maskKey(process.env.DD_API_KEY!),
          app_key: maskKey(process.env.DD_APPLICATION_KEY!),
        };
      }

      if (fileConfig) {
        result.config_file = {
          status: "configured",
          method: "api_key",
          site: fileConfig.site,
          api_key: maskKey(fileConfig.api_key),
          app_key: maskKey(fileConfig.app_key),
          path: getConfigFilePaths().file,
        };
      }

      if (tokens) {
        const expired = isExpired(tokens);
        const expiresAt = tokens.issued_at + tokens.expires_in;
        result.oauth = {
          status: expired ? "expired" : "authenticated",
          method: "oauth2",
          site,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expires_at: new Date(expiresAt * 1000).toISOString(),
          issued_at: new Date(tokens.issued_at * 1000).toISOString(),
          has_refresh_token: Boolean(tokens.refresh_token),
        };
      }

      if (activeSource === "none") {
        result.status = "unauthenticated";
        result.has_client = clientCreds !== null;
      }

      console.log(JSON.stringify(result));
    } catch (error) {
      handleError(error);
    }
  });

// --- auth configure ---
const configureCommand = new Command("configure").description(
  "Configure API Key credentials",
);

configureCommand
  .command("show")
  .description("Show current API Key configuration (keys are masked)")
  .action(() => {
    try {
      const config = loadApiKeyConfig();
      const paths = getConfigFilePaths();

      if (!config) {
        console.log(
          JSON.stringify({
            status: "not_configured",
            config_file: paths.file,
          }),
        );
        return;
      }

      console.log(
        JSON.stringify({
          status: "configured",
          api_key: maskKey(config.api_key),
          app_key: maskKey(config.app_key),
          site: config.site,
          config_file: paths.file,
        }),
      );
    } catch (error) {
      handleError(error);
    }
  });

configureCommand
  .option("--api-key <key>", "Datadog API Key")
  .option("--app-key <key>", "Datadog Application Key")
  .option("--site <site>", "Datadog site")
  .action(
    async (options: {
      apiKey?: string;
      appKey?: string;
      site?: string;
    }) => {
      try {
        let apiKey = options.apiKey;
        let appKey = options.appKey;
        let site = options.site;

        // If any option is missing, prompt interactively
        if (!apiKey || !appKey) {
          if (!apiKey) {
            apiKey = await readPassword("DD_API_KEY: ");
          }
          if (!appKey) {
            appKey = await readPassword("DD_APPLICATION_KEY: ");
          }
          if (!site) {
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stderr,
            });
            try {
              site = (await rl.question("DD_SITE (datadoghq.com): ")) || "datadoghq.com";
            } finally {
              rl.close();
            }
          }
        }

        if (!apiKey || !appKey) {
          throw new Error("API Key and Application Key are required.");
        }

        saveApiKeyConfig({
          api_key: apiKey,
          app_key: appKey,
          site: site ?? "datadoghq.com",
        });

        const paths = getConfigFilePaths();
        console.log(
          JSON.stringify({
            status: "configured",
            api_key: maskKey(apiKey),
            app_key: maskKey(appKey),
            site: site ?? "datadoghq.com",
            config_file: paths.file,
          }),
        );
      } catch (error) {
        handleError(error);
      }
    },
  );

authCommand.addCommand(configureCommand);

// --- auth logout ---
authCommand
  .command("logout")
  .description("Delete tokens and client credentials")
  .option("--site <site>", "Datadog site", getDefaultSite())
  .action((options: { site: string }) => {
    try {
      const site = options.site;
      const tokensDeleted = deleteTokens(site);
      const clientDeleted = deleteClient(site);

      console.log(
        JSON.stringify({
          status: "logged_out",
          site,
          tokens_deleted: tokensDeleted,
          client_deleted: clientDeleted,
        }),
      );
    } catch (error) {
      handleError(error);
    }
  });
