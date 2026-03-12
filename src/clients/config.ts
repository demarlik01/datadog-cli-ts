import { client } from "@datadog/datadog-api-client";
import { getValidAccessToken, loadTokens } from "../auth/token.js";

function getSite(): string {
  return process.env.DD_SITE ?? "datadoghq.com";
}

function hasApiKeys(): boolean {
  return Boolean(process.env.DD_API_KEY && process.env.DD_APPLICATION_KEY);
}

function hasOAuthTokens(site: string): boolean {
  return loadTokens(site) !== null;
}

/**
 * 설정을 생성한다.
 * OAuth 토큰 사용 시 자동 갱신이 필요하므로 비동기 함수.
 *
 * 우선순위: 환경변수(API Key) > OAuth 토큰
 */
export async function createConfig(): Promise<client.Configuration> {
  const site = getSite();

  if (hasApiKeys()) {
    const config = client.createConfiguration({
      authMethods: {
        apiKeyAuth: process.env.DD_API_KEY,
        appKeyAuth: process.env.DD_APPLICATION_KEY,
      },
    });
    config.setServerVariables({ site });
    return config;
  }

  if (hasOAuthTokens(site)) {
    const accessToken = await getValidAccessToken(site);
    const config = client.createConfiguration({
      authMethods: {
        AuthZ: { accessToken },
      },
    });
    config.setServerVariables({ site });
    return config;
  }

  throw new Error(
    "인증 정보가 없습니다. DD_API_KEY/DD_APPLICATION_KEY 환경변수를 설정하거나 `dd-cli auth login`을 실행하세요.",
  );
}
