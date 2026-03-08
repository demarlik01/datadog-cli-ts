import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  issued_at: number;
  scope: string;
  client_id: string;
}

export interface ClientCredentials {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  registered_at: number;
  site: string;
}

const CONFIG_DIR_NAME = "dd-cli";

function getConfigDir(): string {
  const dir = path.join(os.homedir(), ".config", CONFIG_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function sanitizeSite(site: string): string {
  return site.replace(/\./g, "_");
}

export function saveTokens(site: string, tokens: TokenSet): void {
  const filePath = path.join(
    getConfigDir(),
    `tokens_${sanitizeSite(site)}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function loadTokens(site: string): TokenSet | null {
  const filePath = path.join(
    getConfigDir(),
    `tokens_${sanitizeSite(site)}.json`,
  );
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as TokenSet;
  } catch {
    return null;
  }
}

export function deleteTokens(site: string): boolean {
  const filePath = path.join(
    getConfigDir(),
    `tokens_${sanitizeSite(site)}.json`,
  );
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function saveClient(site: string, creds: ClientCredentials): void {
  const filePath = path.join(
    getConfigDir(),
    `client_${sanitizeSite(site)}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function loadClient(site: string): ClientCredentials | null {
  const filePath = path.join(
    getConfigDir(),
    `client_${sanitizeSite(site)}.json`,
  );
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ClientCredentials;
  } catch {
    return null;
  }
}

export function deleteClient(site: string): boolean {
  const filePath = path.join(
    getConfigDir(),
    `client_${sanitizeSite(site)}.json`,
  );
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isExpired(tokens: TokenSet): boolean {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokens.issued_at + tokens.expires_in;
  return now >= expiresAt - 300; // 5분 버퍼
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export async function exchangeCode(
  site: string,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
): Promise<TokenSet> {
  const url = `https://api.${site}/oauth2/v1/token`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`토큰 교환 실패 (HTTP ${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as TokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    scope: data.scope,
    issued_at: Math.floor(Date.now() / 1000),
    client_id: clientId,
  };
}

export async function refreshToken(
  site: string,
  refresh: string,
  clientId: string,
): Promise<TokenSet> {
  const url = `https://api.${site}/oauth2/v1/token`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refresh,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`토큰 갱신 실패 (HTTP ${resp.status}): ${body}`);
  }

  const data = (await resp.json()) as TokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    scope: data.scope,
    issued_at: Math.floor(Date.now() / 1000),
    client_id: clientId,
  };
}

export async function getValidAccessToken(site: string): Promise<string> {
  const tokens = loadTokens(site);
  if (!tokens) {
    throw new Error(
      "인증되지 않음. `dd-cli auth login`을 실행하세요.",
    );
  }

  if (!isExpired(tokens)) {
    return tokens.access_token;
  }

  // 자동 갱신
  const refreshed = await refreshToken(
    site,
    tokens.refresh_token,
    tokens.client_id,
  );
  saveTokens(site, refreshed);
  return refreshed.access_token;
}
