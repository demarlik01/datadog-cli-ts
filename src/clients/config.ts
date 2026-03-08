import { client } from "@datadog/datadog-api-client";

function getRequiredEnv(name: "DD_API_KEY" | "DD_APPLICATION_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name}가 필요합니다.`);
  }
  return value;
}

export function createConfig(): client.Configuration {
  const apiKey = getRequiredEnv("DD_API_KEY");
  const appKey = getRequiredEnv("DD_APPLICATION_KEY");
  const site = process.env.DD_SITE || "datadoghq.com";

  const config = client.createConfiguration({
    authMethods: {
      apiKeyAuth: apiKey,
      appKeyAuth: appKey
    }
  });

  client.setServerVariables(config, { site });

  return config;
}
