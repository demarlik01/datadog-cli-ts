import type { ClientCredentials } from "./token.js";
import { loadClient, saveClient } from "./token.js";

interface DcrResponse {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
}

async function registerNewClient(
  site: string,
  redirectUri: string,
): Promise<ClientCredentials> {
  const url = `https://api.${site}/api/v2/oauth2/register`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Datadog DCR은 이 client_name만 허용 (pup CLI와 동일).
      // ref: https://github.com/datadog-labs/pup/blob/main/src/auth/dcr.rs
      client_name: "datadog-api-claude-plugin",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });

  if (resp.status !== 201) {
    const body = await resp.text();
    throw new Error(`DCR 실패 (HTTP ${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as DcrResponse;
  return {
    client_id: data.client_id,
    client_name: data.client_name,
    redirect_uris: data.redirect_uris,
    registered_at: Math.floor(Date.now() / 1000),
    site,
  };
}

export async function getOrRegisterClient(
  site: string,
  redirectUri: string,
): Promise<ClientCredentials> {
  const existing = loadClient(site);
  if (existing && existing.redirect_uris.includes(redirectUri)) {
    return existing;
  }

  // 캐시된 클라이언트가 없거나 redirect_uri가 변경된 경우 재등록
  const creds = await registerNewClient(site, redirectUri);
  saveClient(site, creds);
  return creds;
}
