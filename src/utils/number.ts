export function parsePositiveInt(input: string, optionName: string): number {
  if (!/^\d+$/.test(input)) {
    throw new Error(`\`${optionName}\`은 1 이상의 정수여야 합니다.`);
  }

  const value = Number.parseInt(input, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`\`${optionName}\`은 1 이상의 정수여야 합니다.`);
  }

  return value;
}
