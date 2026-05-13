/**
 * 動画一覧 (フェーズ 4b)
 *
 * 仕様: 実装計画 フェーズ4b「VideoList: 1 本だけ表示でも一覧構造を作っておく」
 *
 * 各行の構成 (左→右):
 *   [Checkbox]            … 文字起こしキューの対象選択 (デフォルト全 ON)
 *   [ステータスアイコン] … 進行中スピナー / transcript 有 (緑チェック) / 未生成 (薄丸)
 *   [ファイル名]
 *
 * `onToggle(videoPath)` で App 側の選択 Set を更新する。
 */

import {
  Box,
  Checkbox,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";

import type { VideoEntry } from "../../shared/ipc-api.js";

interface Props {
  videos: VideoEntry[];
  selected: VideoEntry | null;
  onSelect: (v: VideoEntry) => void;
  /** 文字起こしキューに入っている videoPath の集合 */
  checked: ReadonlySet<string>;
  /** チェック状態の切替 */
  onToggle: (videoPath: string) => void;
  /** 一括 ON/OFF (ヘッダから) */
  onToggleAll: (next: boolean) => void;
  transcribingVideo: string | null;
}

export default function VideoList({
  videos,
  selected,
  onSelect,
  checked,
  onToggle,
  onToggleAll,
  transcribingVideo,
}: Props) {
  if (videos.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          動画がありません
        </Typography>
      </Box>
    );
  }

  const allChecked = videos.every((v) => checked.has(v.videoPath));
  const someChecked = !allChecked && videos.some((v) => checked.has(v.videoPath));

  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
          background: "background.paper",
        }}
      >
        <Checkbox
          size="small"
          checked={allChecked}
          indeterminate={someChecked}
          onChange={(e) => onToggleAll(e.target.checked)}
          sx={{ p: 0.5 }}
        />
        <Typography variant="caption" color="text.secondary">
          {checked.size} / {videos.length} 選択中
        </Typography>
      </Box>
      <List dense disablePadding>
        {videos.map((v) => {
          const isSelected = selected?.videoPath === v.videoPath;
          const isTranscribing = transcribingVideo === v.videoPath;
          const isChecked = checked.has(v.videoPath);
          const name = v.videoPath.split("/").pop() ?? v.videoPath;
          return (
            <ListItemButton
              key={v.videoPath}
              selected={isSelected}
              onClick={() => onSelect(v)}
              sx={{ pl: 0.5 }}
            >
              <Checkbox
                size="small"
                checked={isChecked}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggle(v.videoPath)}
                sx={{ p: 0.5 }}
              />
              <ListItemIcon sx={{ minWidth: 28 }}>
                {isTranscribing ? (
                  <CircularProgress size={18} />
                ) : v.hasTranscript ? (
                  <CheckCircleIcon fontSize="small" color="success" />
                ) : (
                  <RadioButtonUncheckedIcon
                    fontSize="small"
                    color="disabled"
                  />
                )}
              </ListItemIcon>
              <ListItemText
                primary={name}
                slotProps={{
                  primary: { noWrap: true, sx: { fontSize: 12 } },
                  // ListItemText の secondary は既定で <p> でラップされるため、
                  // 中に <Chip> (div) を置くと DOM nesting 違反になる。<span> に変更。
                  secondary: { component: "span" },
                }}
                secondary={
                  v.hasTranscript ? (
                    <Chip
                      label="transcript あり"
                      size="small"
                      color="success"
                      variant="outlined"
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  ) : null
                }
              />
            </ListItemButton>
          );
        })}
      </List>
    </>
  );
}
