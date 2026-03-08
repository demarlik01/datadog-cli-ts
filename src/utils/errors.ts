function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const direct = error.statusCode;
  if (typeof direct === "number") {
    return direct;
  }

  const response = error.response;
  if (isRecord(response) && typeof response.statusCode === "number") {
    return response.statusCode;
  }

  return undefined;
}

function extractBody(error: unknown): unknown {
  if (!isRecord(error)) {
    return undefined;
  }

  if ("body" in error) {
    return error.body;
  }

  const response = error.response;
  if (isRecord(response) && "body" in response) {
    return response.body;
  }

  return undefined;
}

function extractMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  return undefined;
}

function extractBodyMessage(body: unknown): string | undefined {
  if (typeof body === "string") {
    try {
      return extractBodyMessage(JSON.parse(body));
    } catch {
      return body;
    }
  }

  if (Array.isArray(body)) {
    const joined = body.filter((item) => typeof item === "string").join(", ");
    return joined || undefined;
  }

  if (!isRecord(body)) {
    return undefined;
  }

  if (Array.isArray(body.errors)) {
    const joined = body.errors.filter((item) => typeof item === "string").join(", ");
    if (joined) {
      return joined;
    }
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  if (typeof body.message === "string") {
    return body.message;
  }

  return undefined;
}

function isNetworkError(message: string): boolean {
  return /(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network)/i.test(message);
}

export function handleError(error: unknown): never {
  const statusCode = extractStatusCode(error);
  const bodyMessage = extractBodyMessage(extractBody(error));
  const rawMessage = extractMessage(error);

  let message = bodyMessage || rawMessage || "알 수 없는 오류가 발생했습니다.";

  if (statusCode === 401 || statusCode === 403) {
    message = "인증 실패. DD_API_KEY / DD_APPLICATION_KEY / DD_SITE 값을 확인하세요.";
  } else if (typeof statusCode === "number") {
    message = `Datadog API 요청 실패 (HTTP ${statusCode})${bodyMessage ? `: ${bodyMessage}` : ""}`;
  } else if (rawMessage && isNetworkError(rawMessage)) {
    message = "Datadog API 연결 실패. 네트워크 상태와 DD_SITE 값을 확인하세요.";
  }

  console.error(message);
  process.exit(1);
}
