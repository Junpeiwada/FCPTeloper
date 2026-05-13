/**
 * 動画プレビュー (フェーズ 4b)
 *
 * 仕様: 実装計画 フェーズ4b「VideoPlayer: <video> プレビュー、セグメントクリックで start にシーク」
 *
 * - `media://` カスタムプロトコル経由でローカル動画を再生する (main.ts で登録)
 * - ref forwarding でシーク制御を親 (App) に委ねる
 */

import { Box, Typography } from "@mui/material";
import { forwardRef } from "react";

import { toMediaUrl } from "../../shared/media-url.js";

interface Props {
  videoPath: string | null;
}

const VideoPlayer = forwardRef<HTMLVideoElement, Props>(
  function VideoPlayer({ videoPath }, ref) {
    if (!videoPath) {
      return (
        <Box
          sx={{
            height: 240,
            background: "#000",
            color: "#888",
            borderRadius: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography variant="body2">動画未選択</Typography>
        </Box>
      );
    }
    const url = toMediaUrl(videoPath);
    return (
      <Box
        sx={{
          background: "#000",
          borderRadius: 1,
          overflow: "hidden",
          maxHeight: 320,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <video
          ref={ref}
          src={url}
          controls
          preload="metadata"
          style={{ maxHeight: 320, width: "100%" }}
        />
      </Box>
    );
  },
);

export default VideoPlayer;
