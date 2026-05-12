/**
 * FCPXML 同型比較ハーネス (フェーズ 4a)
 *
 * 目的: スナップショット完全一致比較を採用するが、属性順揺れや空白差を吸収するため、
 *       fast-xml-parser でパースして正規化した JS オブジェクト同士を比較する。
 *
 * 使い方:
 *   npx tsx scripts/diff-fcpxml.ts <a.fcpxml> <b.fcpxml>
 *   npm run fcpxml:diff -- <a.fcpxml> <b.fcpxml>
 *
 * exit code:
 *   0 ... 等価
 *   1 ... 差分あり (差分内容を stderr に出力)
 *   64 ... 引数エラー
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

function printUsage(code: number): never {
  process.stderr.write(
    "usage: npx tsx scripts/diff-fcpxml.ts <a.fcpxml> <b.fcpxml>\n",
  );
  process.exit(code);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: false,
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  ignoreDeclaration: false,
});

/**
 * fast-xml-parser の出力を正規化:
 *   - オブジェクトのキーを昇順ソート
 *   - 配列はそのままの順序を保つ (タイムライン要素の順序は意味を持つ)
 *   - 空文字や undefined は除去
 */
function normalize(node: unknown): unknown {
  if (node === null || node === undefined) return null;
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(normalize);
  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = normalize(obj[key]);
  }
  return out;
}

function loadAndNormalize(path: string): unknown {
  const raw = readFileSync(path, "utf-8");
  const parsed = parser.parse(raw);
  return normalize(parsed);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2) printUsage(64);
  const a = resolve(args[0]);
  const b = resolve(args[1]);

  const na = loadAndNormalize(a);
  const nb = loadAndNormalize(b);

  const sa = JSON.stringify(na, null, 2);
  const sb = JSON.stringify(nb, null, 2);

  if (sa === sb) {
    process.stdout.write(`[diff-fcpxml] EQUAL: ${a} == ${b}\n`);
    process.exit(0);
  }

  process.stderr.write(`[diff-fcpxml] DIFFERS: ${a} vs ${b}\n`);
  // 差分の最初の数行をシンプル diff として出す
  const linesA = sa.split("\n");
  const linesB = sb.split("\n");
  const limit = Math.max(linesA.length, linesB.length);
  let shown = 0;
  for (let i = 0; i < limit && shown < 30; i++) {
    const la = linesA[i] ?? "";
    const lb = linesB[i] ?? "";
    if (la !== lb) {
      process.stderr.write(`  L${i + 1}\n    A: ${la}\n    B: ${lb}\n`);
      shown++;
    }
  }
  process.exit(1);
}

main();
