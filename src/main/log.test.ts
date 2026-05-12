import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log, logger, redactPii, getLogFile, getLogDir, _resetForTest } from "./log.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "fcpteloper-log-"));
  process.env.FCPTELOPER_LOG_DIR = tmpDir;
  _resetForTest();
});

afterEach(() => {
  delete process.env.FCPTELOPER_LOG_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
  _resetForTest();
});

describe("redactPii", () => {
  it("replaces 'text' with text_len", () => {
    const r = redactPii({ text: "秘密の本文", id: 0 });
    expect(r).toEqual({ text_len: 5, id: 0 });
  });

  it("replaces 'telop_text' with telop_text_len", () => {
    const r = redactPii({ telop_text: "テロップ", other: 1 });
    expect(r).toEqual({ telop_text_len: 4, other: 1 });
  });

  it("replaces additional body-like keys (prompt/body/content/message/response/output)", () => {
    const r = redactPii({
      prompt: "x".repeat(100),
      body: "y".repeat(50),
      content: "z".repeat(10),
      message: "m".repeat(5),
      response: "r".repeat(3),
      output: "o".repeat(2),
    });
    expect(r).toEqual({
      prompt_len: 100,
      body_len: 50,
      content_len: 10,
      message_len: 5,
      response_len: 3,
      output_len: 2,
    });
  });

  it("matches camelCase variants via suffix pattern (userPrompt / assistantText)", () => {
    const r = redactPii({ userPrompt: "abcd", assistantText: "xyz" });
    expect(r).toEqual({ userPrompt_len: 4, assistantText_len: 3 });
  });

  it("recurses into nested objects", () => {
    const r = redactPii({ segment: { id: 1, text: "abc" } });
    expect(r).toEqual({ segment: { id: 1, text_len: 3 } });
  });

  it("redacts each item inside arrays", () => {
    const r = redactPii({
      segments: [
        { id: 0, text: "aa" },
        { id: 1, text: "bbbb" },
      ],
    });
    expect(r).toEqual({
      segments: [
        { id: 0, text_len: 2 },
        { id: 1, text_len: 4 },
      ],
    });
  });

  it("passes non-text-like fields through", () => {
    const r = redactPii({ language: "ja", use: true, count: 3 });
    expect(r).toEqual({ language: "ja", use: true, count: 3 });
  });

  it("truncates long string values that are not in the PII key list", () => {
    const long = "a".repeat(2000);
    const r = redactPii({ note: long });
    const note = (r as { note: string }).note;
    expect(note.length).toBeLessThan(long.length);
    expect(note.startsWith("a".repeat(1024))).toBe(true);
    expect(note).toContain("+976 chars");
  });
});

describe("log() / logger", () => {
  it("writes a JSON line with required fields", () => {
    log("info", "test", "smoke", { count: 1 });
    const content = readFileSync(getLogFile(), "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.level).toBe("info");
    expect(parsed.component).toBe("test");
    expect(parsed.event).toBe("smoke");
    expect(parsed.data).toEqual({ count: 1 });
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never writes transcript text body verbatim", () => {
    logger.info("transcribe", "segment_finished", {
      id: 0,
      text: "これは秘密のテキストです、ログに出てはいけない",
    });
    const content = readFileSync(getLogFile(), "utf-8");
    expect(content).not.toContain("これは秘密のテキスト");
    const parsed = JSON.parse(content.trim());
    expect(parsed.data.text_len).toBe("これは秘密のテキストです、ログに出てはいけない".length);
    expect(parsed.data).not.toHaveProperty("text");
  });

  it("appends multiple entries one per line", () => {
    logger.info("a", "e1");
    logger.warn("b", "e2");
    logger.error("c", "e3");
    const lines = readFileSync(getLogFile(), "utf-8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).level).toBe("info");
    expect(JSON.parse(lines[1]).level).toBe("warn");
    expect(JSON.parse(lines[2]).level).toBe("error");
  });

  it("omits data field when undefined", () => {
    logger.info("a", "no_data");
    const parsed = JSON.parse(readFileSync(getLogFile(), "utf-8").trim());
    expect(parsed).not.toHaveProperty("data");
  });

  it("does not throw on circular reference (replaces cycle with marker)", () => {
    const circ: Record<string, unknown> = { a: 1 };
    circ.self = circ;
    expect(() => logger.info("a", "circ", circ)).not.toThrow();
    const parsed = JSON.parse(readFileSync(getLogFile(), "utf-8").trim());
    expect(parsed.level).toBe("info");
    expect(parsed.data.a).toBe(1);
    expect(parsed.data.self).toBe("[Circular]");
  });

  it("rotates log file when previous day's file exists", () => {
    const logPath = getLogFile();
    writeFileSync(logPath, '{"old":true}\n', "utf-8");
    // mtime を 2 日前にずらす
    const twoDaysAgoMs = Date.now() - 2 * 24 * 60 * 60 * 1000;
    utimesSync(logPath, twoDaysAgoMs / 1000, twoDaysAgoMs / 1000);

    logger.info("a", "after_rotate");

    const files = readdirSync(tmpDir);
    // 元の app.log は残るが内容は新規エントリのみになっているはず
    expect(files).toContain("app.log");
    const rotated = files.filter((f) => f.match(/^app\.\d{4}-\d{2}-\d{2}\.\d{3}\.log$/));
    expect(rotated).toHaveLength(1);
    const current = readFileSync(logPath, "utf-8").trim();
    expect(current).not.toContain("old");
    expect(JSON.parse(current).event).toBe("after_rotate");
  });
});

describe("getLogDir override", () => {
  it("respects FCPTELOPER_LOG_DIR env", () => {
    expect(getLogDir()).toBe(tmpDir);
  });

  it("places log file under that directory", () => {
    log("info", "a", "e");
    const files = readdirSync(tmpDir);
    expect(files).toContain("app.log");
  });
});

describe("log() failure safety", () => {
  it("does not throw when log directory cannot be created", () => {
    // 既存ファイルをディレクトリ名として指定 → mkdirSync が失敗
    const blocker = join(tmpDir, "blocker");
    writeFileSync(blocker, "x", "utf-8");
    process.env.FCPTELOPER_LOG_DIR = join(blocker, "nested");
    _resetForTest();

    expect(() => log("info", "a", "e", { x: 1 })).not.toThrow();
    // 念のため statSync で blocker がファイルのままなことを確認 (副作用なし)
    expect(statSync(blocker).isFile()).toBe(true);
  });
});
