import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetForTest,
  allowFolder,
  isMediaAllowed,
} from "./media-allowlist.js";

beforeEach(() => {
  _resetForTest();
});

describe("media-allowlist", () => {
  it("denies everything before any folder is allowed", () => {
    expect(isMediaAllowed("/Users/foo/movie.mp4")).toBe(false);
  });

  it("allows video under registered folder", () => {
    allowFolder("/Users/foo/videos");
    expect(isMediaAllowed("/Users/foo/videos/movie.mp4")).toBe(true);
    expect(isMediaAllowed("/Users/foo/videos/sub/movie.mov")).toBe(true);
  });

  it("rejects video outside registered folder", () => {
    allowFolder("/Users/foo/videos");
    expect(isMediaAllowed("/Users/foo/other/movie.mp4")).toBe(false);
    expect(isMediaAllowed("/etc/passwd")).toBe(false);
  });

  it("rejects non-video extensions even inside allowed folder", () => {
    allowFolder("/Users/foo/videos");
    expect(isMediaAllowed("/Users/foo/videos/note.txt")).toBe(false);
    expect(isMediaAllowed("/Users/foo/videos/secret.key")).toBe(false);
  });

  it("normalizes paths to defeat .. traversal", () => {
    allowFolder("/Users/foo/videos");
    // /Users/foo/videos/../../passwd は /Users/passwd に正規化されるので外
    expect(isMediaAllowed("/Users/foo/videos/../../etc/passwd.mp4")).toBe(false);
    expect(isMediaAllowed("/Users/foo/videos/sub/../../bar/movie.mp4")).toBe(
      false,
    );
  });

  it("treats sibling folder prefix correctly (videos2 should not match videos)", () => {
    allowFolder("/Users/foo/videos");
    // 末尾 sep 付きで比較するため /Users/foo/videos2/x.mp4 は許可されない
    expect(isMediaAllowed("/Users/foo/videos2/x.mp4")).toBe(false);
  });

  it("supports multiple registered folders", () => {
    allowFolder("/Users/a");
    allowFolder("/Users/b");
    expect(isMediaAllowed("/Users/a/x.mp4")).toBe(true);
    expect(isMediaAllowed("/Users/b/y.mov")).toBe(true);
    expect(isMediaAllowed("/Users/c/z.mp4")).toBe(false);
  });
});
