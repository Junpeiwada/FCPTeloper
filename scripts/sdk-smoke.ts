/**
 * Claude Agent SDK 疎通確認スクリプト (フェーズ1)
 *
 * Max 枠 (OAuth) 経路で Claude が呼び出せることを確認する。
 * ANTHROPIC_API_KEY が未設定でも動くこと = ~/.claude の OAuth トークン経由で
 *   認証できていること = preset="claude_code" + settingSources=["user"] が
 *   正しく効いていることの証明。
 *
 * 使い方:
 *   unset ANTHROPIC_API_KEY
 *   npm run sdk:smoke -- "1+1は?"
 *
 * 出力:
 *   標準出力に Claude の応答テキスト 1 つ。
 *   レート制限時は ClaudeRateLimitError を投げて exit code 2 で終了。
 *   その他エラーは exit code 1。
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeRateLimitError, isLimitErrorText } from "../src/shared/errors.js";
import { logger } from "../src/main/log.js";

async function main(): Promise<void> {
  const userPrompt = process.argv.slice(2).join(" ").trim();
  if (!userPrompt) {
    process.stderr.write(
      "usage: npm run sdk:smoke -- <プロンプト文字列>\n" +
        '  例: npm run sdk:smoke -- "1+1は?"\n',
    );
    process.exit(64); // EX_USAGE
  }

  process.stderr.write(
    `[sdk-smoke] sending prompt (chars=${userPrompt.length}) via Max枠 OAuth...\n`,
  );
  logger.info("sdk-smoke", "request_start", { prompt_len: userPrompt.length });

  const stream = query({
    prompt: userPrompt,
    options: {
      cwd: process.cwd(),
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user"],
      permissionMode: "default",
      // ツール使用は不要 (純テキスト変換)。全 deny にする。
      canUseTool: async (toolName) => ({
        behavior: "deny",
        message: `tool '${toolName}' is not permitted in sdk-smoke`,
        interrupt: true,
      }),
    },
  });

  let resultText = "";
  let sessionId: string | null = null;
  const stderrBuf: string[] = [];

  for await (const msg of stream) {
    // セッションID取得 (デバッグ用)
    if (msg.type === "system" && "subtype" in msg && msg.subtype === "init") {
      sessionId = (msg as { session_id?: string }).session_id ?? null;
      if (sessionId) {
        process.stderr.write(`[sdk-smoke] session_id=${sessionId}\n`);
        logger.info("sdk-smoke", "session_init", { session_id: sessionId });
      }
    }

    if (msg.type === "result" && "result" in msg && typeof msg.result === "string") {
      resultText = msg.result;
    }
  }

  if (!resultText) {
    // result が空だった場合のフォールバック
    const combinedStderr = stderrBuf.join("\n");
    if (isLimitErrorText(combinedStderr)) {
      throw new ClaudeRateLimitError(combinedStderr.trim());
    }
    process.stderr.write(
      "[sdk-smoke] WARN: 応答テキストが空でした。Claude SDK 経路の問題の可能性。\n",
    );
    process.exit(1);
  }

  // レート制限テキストが応答に混じっていたら専用エラーで止める
  if (isLimitErrorText(resultText)) {
    throw new ClaudeRateLimitError(resultText.trim());
  }

  // 本文はログに残さず長さのみ記録 (redactPii の挙動にも二重防御で頼る)
  logger.info("sdk-smoke", "request_done", { text_len: resultText.length });

  process.stdout.write(resultText);
  if (!resultText.endsWith("\n")) process.stdout.write("\n");
}

main().catch((err: unknown) => {
  if (err instanceof ClaudeRateLimitError) {
    process.stderr.write(`[sdk-smoke] RATE LIMIT: ${err.message}\n`);
    process.exit(2);
  }
  const msg = err instanceof Error ? err.message : String(err);
  // SDK 内部のレート制限テキストも検出
  if (isLimitErrorText(msg)) {
    process.stderr.write(`[sdk-smoke] RATE LIMIT (from raw error): ${msg}\n`);
    process.exit(2);
  }
  process.stderr.write(`[sdk-smoke] ERROR: ${msg}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  process.exit(1);
});
