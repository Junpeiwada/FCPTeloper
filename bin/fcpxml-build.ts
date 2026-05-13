/**
 * FCPXML 新規モード生成 CLI (フェーズ 4a)
 *
 * 仕様: 仕様書 §8.3〜§8.7 / 実装計画 フェーズ4a
 *
 * 使い方:
 *   npm run fcpxml:build -- <transcript.json>... -o <out.fcpxml> [--project <name>]
 *
 * exit code:
 *   0 ... OK
 *   1 ... 実行時エラー (Zod 違反 / fps 非整数 / IO 失敗等)
 *   64 ... 引数エラー
 */

import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { validateTranscript } from "../src/shared/transcript-schema.js";
import { buildFcpxmlFromTranscripts } from "../src/main/fcpxml_write.js";
import { logger } from "../src/main/log.js";

interface ParsedArgs {
  inputs: string[];
  output: string;
  projectName?: string;
}

function printUsage(code: number): never {
  process.stderr.write(
    "usage: npm run fcpxml:build -- <transcript.json>... -o <out.fcpxml> [--project <name>]\n",
  );
  process.exit(code);
}

/** 値ありオプションの引数を取り出す。値が無い・次がフラグなら usage エラー。*/
function takeValue(argv: string[], i: number, name: string): string {
  const v = argv[i];
  if (v === undefined || v.startsWith("-")) {
    process.stderr.write(`[fcpxml-build] option ${name} requires a value\n`);
    printUsage(64);
  }
  return v;
}

function parseArgs(argv: string[]): ParsedArgs {
  const inputs: string[] = [];
  let output: string | undefined;
  let projectName: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") {
      output = takeValue(argv, ++i, a);
    } else if (a === "--project") {
      projectName = takeValue(argv, ++i, a);
    } else if (a.startsWith("-")) {
      process.stderr.write(`[fcpxml-build] unknown option: ${a}\n`);
      printUsage(64);
    } else {
      inputs.push(a);
    }
  }

  if (inputs.length === 0 || !output) printUsage(64);
  return { inputs, output, projectName };
}

function fatal(event: string, message: string, context: Record<string, unknown> = {}): never {
  process.stderr.write(`[fcpxml-build] ${message}\n`);
  logger.error("fcpxml-build", event, { ...context, message });
  process.exit(1);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const transcripts = args.inputs.map((p) => {
    const abs = resolve(p);
    let raw: string;
    try {
      raw = readFileSync(abs, "utf-8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fatal("read_failed", `read failed: ${abs}: ${msg}`, { abs });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fatal("json_parse_failed", `JSON parse failed: ${abs}: ${msg}`, { abs });
    }
    const v = validateTranscript(json);
    if (!v.ok) {
      process.stderr.write(`[fcpxml-build] schema violation: ${abs}\n`);
      for (const issue of v.error.issues) {
        const where = issue.path.length > 0 ? issue.path.join(".") : "<root>";
        process.stderr.write(`  - ${where}: ${issue.message}\n`);
      }
      logger.error("fcpxml-build", "schema_violation", {
        abs,
        issues: v.error.issues.length,
      });
      process.exit(1);
    }
    if (!isAbsolute(v.value.source_video)) {
      fatal(
        "source_video_not_absolute",
        `source_video must be absolute path in ${abs} (got "${v.value.source_video}")`,
        { abs, source_video: v.value.source_video },
      );
    }
    return v.value;
  });

  let xml: string;
  try {
    xml = buildFcpxmlFromTranscripts(transcripts, { projectName: args.projectName });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fatal("build_failed", msg);
  }

  const outAbs = resolve(args.output);
  try {
    writeFileSync(outAbs, xml, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fatal("write_failed", `write failed: ${outAbs}: ${msg}`, { outAbs });
  }

  process.stdout.write(`[fcpxml-build] OK -> ${outAbs}\n`);
  logger.info("fcpxml-build", "ok", {
    output: outAbs,
    inputs: args.inputs.length,
  });
}

main();
