/**
 * Claude SDK 呼び出し時のレート制限エラーを表す型。
 * CLI / IPC 両経路で同じ型として catch できるよう、shared に置く。
 */
export class ClaudeRateLimitError extends Error {
  readonly kind = "limit" as const;
  constructor(message: string) {
    super(message);
    this.name = "ClaudeRateLimitError";
  }
}

/**
 * Claude Code / Anthropic 側からのテキストがレート制限文言かを判定する。
 * AgentNest の `isLimitErrorText` を移植。
 *
 * 既知のパターン:
 *  - "spending cap reached"
 *  - "you've hit your limit"
 *  - "limit ... resets 3pm" / "cap ... resets 03:00 am" など
 */
export function isLimitErrorText(content: string): boolean {
  if (!content) return false;
  return (
    /spending cap reached|you'?ve hit your limit/i.test(content) ||
    (/resets\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)/i.test(content) &&
      /limit|cap/i.test(content))
  );
}
