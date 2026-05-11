import { describe, it, expect } from "vitest";
import { ClaudeRateLimitError, isLimitErrorText } from "./errors.js";

describe("isLimitErrorText", () => {
  it("matches 'spending cap reached'", () => {
    expect(isLimitErrorText("Your spending cap reached for this month.")).toBe(
      true,
    );
  });

  it("matches \"you've hit your limit\" (straight ASCII quote)", () => {
    expect(isLimitErrorText("you've hit your limit")).toBe(true);
  });

  it("matches \"youve hit your limit\" (no apostrophe)", () => {
    expect(isLimitErrorText("Sorry — youve hit your limit. Try later.")).toBe(
      true,
    );
  });

  it("matches '5-hour limit reached, resets 3pm'", () => {
    expect(
      isLimitErrorText("5-hour limit reached, resets 3pm UTC"),
    ).toBe(true);
  });

  it("matches 'cap ... resets 03:00 am'", () => {
    expect(
      isLimitErrorText("Your cap is exhausted, resets 03:00 am tomorrow"),
    ).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(isLimitErrorText("foo bar")).toBe(false);
  });

  it("does not match generic errors", () => {
    expect(
      isLimitErrorText("TypeError: Cannot read properties of undefined"),
    ).toBe(false);
  });

  it("does not match 'resets 3pm' without limit/cap keyword", () => {
    expect(isLimitErrorText("The page resets 3pm daily")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isLimitErrorText("")).toBe(false);
  });
});

describe("ClaudeRateLimitError", () => {
  it("is an Error", () => {
    const e = new ClaudeRateLimitError("limit reached");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ClaudeRateLimitError);
  });

  it("has kind='limit' discriminator", () => {
    const e = new ClaudeRateLimitError("limit reached");
    expect(e.kind).toBe("limit");
  });

  it("carries the message", () => {
    const e = new ClaudeRateLimitError("you've hit your limit");
    expect(e.message).toBe("you've hit your limit");
    expect(e.name).toBe("ClaudeRateLimitError");
  });
});
