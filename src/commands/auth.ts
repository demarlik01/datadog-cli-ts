import { Command } from "commander";
import { login } from "../auth/login.js";

function getDefaultSite(): string {
  return process.env.DD_SITE ?? "datadoghq.com";
}
import {
  loadTokens,
  loadClient,
  deleteTokens,
  deleteClient,
  isExpired,
} from "../auth/token.js";
import { handleError } from "../utils/errors.js";

export const authCommand = new Command("auth").description(
  "OAuth2 인증 관리",
);

authCommand
  .command("login")
  .description("OAuth2로 Datadog에 로그인")
  .option("--site <site>", "Datadog 사이트", getDefaultSite())
  .action(async (options: { site: string }) => {
    try {
      await login(options.site);
    } catch (error) {
      handleError(error);
    }
  });

authCommand
  .command("status")
  .description("인증 상태 확인")
  .option("--site <site>", "Datadog 사이트", getDefaultSite())
  .action((options: { site: string }) => {
    try {
      const site = options.site;
      const tokens = loadTokens(site);
      const clientCreds = loadClient(site);

      if (!tokens) {
        console.log(
          JSON.stringify({
            status: "unauthenticated",
            site,
            has_client: clientCreds !== null,
          }),
        );
        return;
      }

      const expired = isExpired(tokens);
      const expiresAt = tokens.issued_at + tokens.expires_in;

      console.log(
        JSON.stringify({
          status: expired ? "expired" : "authenticated",
          site,
          scope: tokens.scope,
          token_type: tokens.token_type,
          expires_at: new Date(expiresAt * 1000).toISOString(),
          issued_at: new Date(tokens.issued_at * 1000).toISOString(),
          has_refresh_token: Boolean(tokens.refresh_token),
        }),
      );
    } catch (error) {
      handleError(error);
    }
  });

authCommand
  .command("logout")
  .description("토큰 및 클라이언트 정보 삭제")
  .option("--site <site>", "Datadog 사이트", getDefaultSite())
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
