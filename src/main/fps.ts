/**
 * fps の整数判定 (フェーズ 4a)
 *
 * 仕様: 仕様書 §8.6 / §11 (ドロップフレーム非対応、29.97/59.94 等は要対応検討)
 *
 * 本フェーズでは整数 fps (30 / 60 等) のみ受け入れ、それ以外は警告付きで停止する。
 */

export interface FpsCheckResult {
  /** 整数 fps として扱える値 */
  fps: number;
  /** 元の浮動小数値 (29.97 等) */
  rawFps: number;
}

/**
 * fps が整数 (= 浮動小数誤差を許容して 1e-6 以内) かを判定する。
 * 許容範囲外なら例外を投げる。
 *
 * `30.000` のような微小誤差は丸めて 30 として扱う。
 * `29.97` は drop-frame の代表値で本フェーズでは非対応。
 */
export function ensureIntegerFps(rawFps: number): FpsCheckResult {
  if (!Number.isFinite(rawFps) || rawFps <= 0) {
    throw new Error(`non-integer fps: invalid value (${rawFps})`);
  }
  const rounded = Math.round(rawFps);
  if (Math.abs(rawFps - rounded) > 1e-6) {
    throw new Error(
      `non-integer fps: ${rawFps} (only integer fps such as 30/60 are supported in this phase)`,
    );
  }
  return { fps: rounded, rawFps };
}

/**
 * 秒 → フレーム数の変換。仕様書 §8.6: round(秒 × fps)。
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}
