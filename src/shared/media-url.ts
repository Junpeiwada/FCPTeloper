/**
 * 絶対パスを renderer 側で `<video src>` として使える `media://` URL に変換する。
 * main.ts で `media://host/<abs path>` を file:// に橋渡しするカスタムプロトコルを登録している。
 *
 * - `encodeURI` だと `?` `#` がそのまま残ってクエリ扱いされるので、
 *   pathname 部分をパスセグメントごとに `encodeURIComponent` する
 * - macOS スコープ前提なのでドライブレターは考慮しない
 */
export function toMediaUrl(absolutePath: string): string {
  if (!absolutePath.startsWith("/")) {
    throw new Error(
      `toMediaUrl: expected absolute POSIX path, got "${absolutePath}"`,
    );
  }
  const encoded = absolutePath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `media://local${encoded}`;
}
