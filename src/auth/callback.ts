import http from "node:http";
import net from "node:net";

export interface CallbackResult {
  code: string;
  state: string;
}

const REDIRECT_PORTS = [8000, 8080, 8888, 9000];
const CALLBACK_PATH = "/oauth/callback";
const TIMEOUT_MS = 5 * 60 * 1000; // 5분

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function findAvailablePort(): Promise<number> {
  for (const port of REDIRECT_PORTS) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(
    `사용 가능한 포트를 찾을 수 없습니다 (시도: ${REDIRECT_PORTS.join(", ")})`,
  );
}

export function buildRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><body style="font-family:system-ui;text-align:center;margin-top:80px">
<h1>인증 성공!</h1><p>이 창을 닫아도 됩니다.</p>
</body></html>`;

const ERROR_HTML = (msg: string) => `<!DOCTYPE html>
<html><body style="font-family:system-ui;text-align:center;margin-top:80px">
<h1>인증 실패</h1><p>${msg}</p>
</body></html>`;

export function startCallbackServer(
  port: number,
  expectedState: string,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end();
        return;
      }

      const error = url.searchParams.get("error");
      if (error) {
        const desc = url.searchParams.get("error_description") ?? error;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML(desc));
        clearTimeout(timeout);
        server.close();
        reject(new Error(`OAuth 인증 실패: ${desc}`));
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML("code 또는 state 파라미터가 없습니다."));
        clearTimeout(timeout);
        server.close();
        reject(new Error("콜백에 code 또는 state가 없습니다."));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(ERROR_HTML("State 불일치 — CSRF 보호 위반"));
        clearTimeout(timeout);
        server.close();
        reject(new Error("State 불일치 — CSRF 보호 위반"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(SUCCESS_HTML);
      clearTimeout(timeout);
      server.close();
      resolve({ code, state });
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("OAuth 콜백 타임아웃 (5분)"));
    }, TIMEOUT_MS);

    server.listen(port, "127.0.0.1");
  });
}
