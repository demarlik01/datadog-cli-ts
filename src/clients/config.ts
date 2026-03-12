import fs from "node:fs";
import path from "node:path";
import { client } from "@datadog/datadog-api-client";
import { getValidAccessToken, loadTokens } from "../auth/token.js";

import { getConfigDir } from "../utils/paths.js";

export interface ApiKeyConfig {
  api_key: string;
  app_key: string;
  site: string;
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadApiKeyConfig(): ApiKeyConfig | null {
  const filePath = getConfigFilePath();
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as Partial<ApiKeyConfig>;
    if (data.api_key && data.app_key) {
      return {
        api_key: data.api_key,
        app_key: data.app_key,
        site: data.site ?? "datadoghq.com",
      };
    }
    return null;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    console.error(`설정 파일 읽기 실패 (${filePath}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export function saveApiKeyConfig(config: ApiKeyConfig): void {
  const filePath = getConfigFilePath();
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function getConfigFilePaths(): { dir: string; file: string } {
  return { dir: getConfigDir(), file: getConfigFilePath() };
}

function getSite(): string {
  return process.env.DD_SITE ?? loadApiKeyConfig()?.site ?? "datadoghq.com";
}

function hasEnvApiKeys(): boolean {
  return Boolean(process.env.DD_API_KEY && process.env.DD_APPLICATION_KEY);
}

function hasOAuthTokens(site: string): boolean {
  return loadTokens(site) !== null;
}

export type AuthSource = "env_vars" | "config_file" | "oauth" | "none";

/**
 * Returns which auth source would be used (without creating a full config).
 */
export function getAuthSource(site?: string): AuthSource {
  const resolvedSite = site ?? getSite();
  if (hasEnvApiKeys()) return "env_vars";
  if (loadApiKeyConfig()) return "config_file";
  if (hasOAuthTokens(resolvedSite)) return "oauth";
  return "none";
}

/**
 * Creates SDK configuration.
 * Async because OAuth token refresh may be needed.
 *
 * Priority: Environment variables (API Key) > Config file (API Key) > OAuth tokens > Error
 */
export async function createConfig(): Promise<client.Configuration> {
  const site = getSite();

  // 1. Environment variables
  if (hasEnvApiKeys()) {
    const config = client.createConfiguration({
      authMethods: {
        apiKeyAuth: process.env.DD_API_KEY,
        appKeyAuth: process.env.DD_APPLICATION_KEY,
      },
    });
    config.setServerVariables({ site });
    return config;
  }

  // 2. Config file
  const fileConfig = loadApiKeyConfig();
  if (fileConfig) {
    const config = client.createConfiguration({
      authMethods: {
        apiKeyAuth: fileConfig.api_key,
        appKeyAuth: fileConfig.app_key,
      },
    });
    config.setServerVariables({ site });
    return config;
  }

  // 3. OAuth tokens
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
    "No credentials found. Set DD_API_KEY/DD_APPLICATION_KEY environment variables, " +
    "run `dd-cli auth configure`, or run `dd-cli auth login`.",
  );
}
