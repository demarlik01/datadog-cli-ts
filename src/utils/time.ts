const RELATIVE_TIME_REGEX = /^(\d+)([smhdw])$/i;

const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000
};

export function parseTimeToIso(input: string, now: Date = new Date()): string {
  const value = input.trim();
  const lower = value.toLowerCase();

  if (lower === "now") {
    return now.toISOString();
  }

  const relativeMatch = RELATIVE_TIME_REGEX.exec(lower);
  if (relativeMatch) {
    const amount = Number.parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const delta = UNIT_TO_MS[unit] * amount;

    return new Date(now.getTime() - delta).toISOString();
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  throw new Error(
    `유효하지 않은 시간 형식: "${input}". 예시: 30m, 1h, 24h, 7d, now, 2024-03-01T00:00:00Z`
  );
}

export function resolveTime(fromInput: string, toInput: string = "now"): { from: string; to: string } {
  const now = new Date();
  const from = parseTimeToIso(fromInput, now);
  const to = parseTimeToIso(toInput, now);

  if (new Date(from).getTime() > new Date(to).getTime()) {
    throw new Error("시간 범위가 올바르지 않습니다. `from`은 `to`보다 이전이어야 합니다.");
  }

  return { from, to };
}
