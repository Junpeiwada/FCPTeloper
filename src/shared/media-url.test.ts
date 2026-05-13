import { describe, expect, it } from "vitest";

import { toMediaUrl } from "./media-url.js";

describe("toMediaUrl", () => {
  it("converts absolute POSIX path to media:// URL", () => {
    expect(toMediaUrl("/Users/foo/movie.mp4")).toBe(
      "media://local/Users/foo/movie.mp4",
    );
  });

  it("percent-encodes special characters per segment", () => {
    expect(toMediaUrl("/tmp/it's me/動画 #1.mp4")).toBe(
      "media://local/tmp/it's%20me/%E5%8B%95%E7%94%BB%20%231.mp4",
    );
  });

  it("rejects relative paths", () => {
    expect(() => toMediaUrl("relative/path.mp4")).toThrow();
  });
});
