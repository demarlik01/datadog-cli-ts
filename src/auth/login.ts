import open from "open";
import { generatePkce, generateState } from "./pkce.js";
import { getOrRegisterClient } from "./dcr.js";
import {
  findAvailablePort,
  buildRedirectUri,
  startCallbackServer,
} from "./callback.js";
import { exchangeCode, saveTokens } from "./token.js";
import { DEFAULT_SCOPES } from "./scopes.js";

export const DEFAULT_SITE = process.env.DD_SITE ?? "datadoghq.com";

export async function login(site: string = DEFAULT_SITE): Promise<void> {
  // 1. 사용 가능한 포트 찾기
  const port = await findAvailablePort();
  const redirectUri = buildRedirectUri(port);

  // 2. DCR (이미 등록된 클라이언트가 있으면 재사용)
  process.stderr.write("OAuth 클라이언트 확인 중...\n");
  const creds = await getOrRegisterClient(site, redirectUri);

  // 3. PKCE + State 생성
  const pkce = generatePkce();
  const state = generateState();

  // 4. 콜백 서버 시작 (비동기)
  const callbackPromise = startCallbackServer(port, state);

  // 5. 브라우저 열기
  const scope = DEFAULT_SCOPES.join(" ");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.client_id,
    redirect_uri: redirectUri,
    state,
    scope,
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method,
  });
  const authUrl = `https://app.${site}/oauth2/v1/authorize?${params}`;

  process.stderr.write("브라우저에서 Datadog 인증 페이지를 엽니다...\n");
  process.stderr.write(
    `\n자동으로 열리지 않으면 이 URL을 직접 열어주세요:\n${authUrl}\n\n`,
  );
  try {
    await open(authUrl);
  } catch {
    process.stderr.write(
      "브라우저 자동 열기 실패. 위 URL을 직접 브라우저에 붙여넣어 주세요.\n",
    );
  }

  // 6. 콜백 대기 (state 검증은 서버 내부에서 수행)
  const result = await callbackPromise;

  // 7. 토큰 교환
  process.stderr.write("토큰 교환 중...\n");
  const tokens = await exchangeCode(
    site,
    result.code,
    redirectUri,
    pkce.verifier,
    creds.client_id,
  );

  // 8. 저장
  saveTokens(site, tokens);

  // 9. 결과 출력 (JSON, stdout)
  console.log(
    JSON.stringify({
      status: "authenticated",
      site,
      scope: tokens.scope,
      expires_in: tokens.expires_in,
    }),
  );
}
