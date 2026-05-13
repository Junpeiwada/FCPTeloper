/**
 * fps の正規化 (フェーズ 4a + NTSC 対応拡張)
 *
 * 仕様: 仕様書 §8.6 / §11
 *
 * フェーズ 4a では整数 fps のみだったが、NTSC (29.97 / 59.94) を有理数として正式サポートする。
 * fps は `{ num, den }` 形式で扱い、frame 数や FCP 時間表記は厳密な有理数演算で組み立てる
 * (長尺でも音ズレが累積しない)。
 *
 * 対応 fps:
 *   - 整数 fps (24 / 25 / 30 / 50 / 60 など) → { num: fps, den: 1 }
 *   - 29.97 (= 30000/1001) → { num: 30000, den: 1001 }
 *   - 59.94 (= 60000/1001) → { num: 60000, den: 1001 }
 * 上記以外 (例: 23.976, 任意の有理数, 0, 負値) は明示的にエラーにする。
 */

export interface FpsRational {
  /** 分子 (1 秒あたりのフレーム数 × den) */
  num: number;
  /** 分母 (整数 fps なら 1、NTSC 系は 1001) */
  den: number;
}

const NTSC_TOLERANCE = 1e-3; // 29.97 / 59.94 の表記揺れ吸収用

/**
 * 数値 fps を有理数表現に正規化する。
 * 許容外の値は例外。
 */
export function normalizeFps(rawFps: number): FpsRational {
  if (!Number.isFinite(rawFps) || rawFps <= 0) {
    throw new Error(`invalid fps: ${rawFps}`);
  }
  // 整数 (微小誤差許容)
  const rounded = Math.round(rawFps);
  if (Math.abs(rawFps - rounded) <= 1e-6) {
    return { num: rounded, den: 1 };
  }
  // NTSC 代表値
  if (Math.abs(rawFps - 30000 / 1001) <= NTSC_TOLERANCE) {
    return { num: 30000, den: 1001 };
  }
  if (Math.abs(rawFps - 60000 / 1001) <= NTSC_TOLERANCE) {
    return { num: 60000, den: 1001 };
  }
  throw new Error(
    `unsupported fps: ${rawFps} (supported: integer fps, 29.97, 59.94)`,
  );
}

/**
 * 2 つの fps が同一かを判定する。`{30,1}` と `{60,2}` のような未約分一致は
 * 想定しない (normalizeFps が返す形式同士の単純比較で足りる)。
 */
export function fpsEquals(a: FpsRational, b: FpsRational): boolean {
  return a.num === b.num && a.den === b.den;
}

/**
 * 秒 → フレーム数の変換。仕様書 §8.6: round(秒 × fps)。
 * 有理数 fps では fps = num/den なので frames = round(seconds * num / den)。
 */
export function secondsToFrames(seconds: number, fps: FpsRational): number {
  return Math.round((seconds * fps.num) / fps.den);
}

/**
 * フレーム数を FCPXML の時間表記文字列に変換する。
 *
 * 整数 fps (den=1):  `"N/num s"`   例: 90 @ 30fps → "90/30s"
 * NTSC fps  (den>1): `"N*den/num s"` 例: 60 @ 59.94fps → "60060/60000s" (= 1.001s)
 *
 * 0 frames は "0s" (FCP の慣習)。
 */
export function framesToFcpTime(frames: number, fps: FpsRational): string {
  if (frames === 0) return "0s";
  if (fps.den === 1) {
    return `${frames}/${fps.num}s`;
  }
  return `${frames * fps.den}/${fps.num}s`;
}

/**
 * FCPXML <format> の frameDuration 属性値を返す。
 * frameDuration は「1 フレームあたりの秒数」なので den/num s。
 *
 * 整数 fps:  "1/30s"
 * NTSC fps:  "1001/60000s"
 */
export function frameDurationString(fps: FpsRational): string {
  return `${fps.den}/${fps.num}s`;
}

/**
 * FCP 既定の <format> 名 (例: "FFVideoFormat3840x2160p5994", "FFVideoFormat1920x1080p30")。
 * FCP は 4K 以上で "WIDTHxHEIGHTp..." 形式を使う。width を渡すことで正確な名前を生成する。
 */
export function defaultFormatName(width: number, height: number, fps: FpsRational): string {
  let fpsLabel: string;
  if (fps.den === 1) {
    fpsLabel = String(fps.num);
  } else if (fps.num === 30000 && fps.den === 1001) {
    fpsLabel = "2997";
  } else if (fps.num === 60000 && fps.den === 1001) {
    fpsLabel = "5994";
  } else {
    // normalizeFps 経由で来る値はこのいずれかに限られるが、防御的に
    fpsLabel = `${fps.num}_${fps.den}`;
  }
  return `FFVideoFormat${width}x${height}p${fpsLabel}`;
}
