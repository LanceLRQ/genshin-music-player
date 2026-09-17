/** 解析 "1/2"、"0.25"、"2" 这类非负数或分数；格式错误或分母为 0 时返回 undefined */
export function parseFraction(raw: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(raw.trim());
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = match[2] === undefined ? 1 : Number(match[2]);
  if (denominator === 0) return undefined;
  return numerator / denominator;
}
