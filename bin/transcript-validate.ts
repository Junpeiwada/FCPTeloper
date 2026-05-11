/**
 * Transcript JSON スキーマ検証 CLI
 *
 * 仕様書 §6 (TranscriptSchema in src/shared/transcript-schema.ts) に準拠しているか
 * Zod でチェックする。
 *
 * 使い方:
 *   npm run transcript:validate -- <transcript.json>
 *
 * exit code:
 *   0 ... スキーマ準拠
 *   1 ... スキーマ違反 (詳細は stderr)
 *   64 ... 引数エラー
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateTranscript } from "../src/shared/transcript-schema.js";

function printUsageAndExit(code: number): never {
  process.stderr.write(
    "usage: npm run transcript:validate -- <transcript.json>\n",
  );
  process.exit(code);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) {
    printUsageAndExit(64);
  }

  const path = resolve(args[0]);
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[transcript-validate] read failed: ${msg}\n`);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[transcript-validate] JSON parse failed: ${msg}\n`);
    process.exit(1);
  }

  const result = validateTranscript(parsed);
  if (result.ok) {
    process.stdout.write(
      `[transcript-validate] OK: ${path} (segments=${result.value.segments.length})\n`,
    );
    process.exit(0);
  }

  process.stderr.write(`[transcript-validate] SCHEMA VIOLATION: ${path}\n`);
  for (const issue of result.error.issues) {
    const where = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    process.stderr.write(`  - ${where}: ${issue.message}\n`);
  }
  process.exit(1);
}

main();
