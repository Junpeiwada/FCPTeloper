/**
 * セグメント一覧 + インライン編集 (フェーズ 4b)
 *
 * 仕様: 実装計画 フェーズ4b
 *   - use チェック、telop_text インライン編集、debounce 500ms 保存
 *   - 行クリックで動画を `start` にシーク
 *
 * 不変保証: `text` フィールドはここで一切変更しない (仕様書 §6)
 */

import {
  Box,
  Checkbox,
  Chip,
  TextField,
  Typography,
} from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";

import type { Segment, Transcript } from "../../shared/transcript-schema.js";

interface Props {
  transcript: Transcript;
  onSeek: (seconds: number) => void;
  onChange: (next: Transcript) => void;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(2);
  return `${m}:${sec.padStart(5, "0")}`;
}

export default function SegmentList({ transcript, onSeek, onChange }: Props) {
  const updateSegment = (id: number, patch: Partial<Segment>) => {
    const next: Transcript = {
      ...transcript,
      segments: transcript.segments.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    };
    onChange(next);
  };

  return (
    <Box>
      {transcript.segments.map((seg, idx) => (
        <Box
          key={seg.id}
          sx={{
            display: "flex",
            alignItems: "flex-start",
            gap: 1,
            p: 1,
            opacity: seg.use ? 1 : 0.55,
            borderTop: idx === 0 ? 0 : 1,
            borderColor: "divider",
            "&:hover": { background: "action.hover" },
          }}
        >
          <Checkbox
            size="small"
            checked={seg.use}
            onChange={(e) => updateSegment(seg.id, { use: e.target.checked })}
            sx={{ p: 0.5, mt: 0.25 }}
          />
          <Box sx={{ minWidth: 92, mt: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                cursor: "pointer",
                color: "primary.main",
                fontFamily: "Menlo, monospace",
                fontSize: 11,
                "&:hover": { textDecoration: "underline" },
              }}
              onClick={() => onSeek(seg.start)}
            >
              {formatTime(seg.start)} - {formatTime(seg.end)}
            </Typography>
            <Box sx={{ display: "flex", gap: 0.5, mt: 0.25, flexWrap: "wrap" }}>
              {seg.language && (
                <Chip
                  label={seg.language}
                  size="small"
                  variant="outlined"
                  sx={{ height: 16, fontSize: 10 }}
                />
              )}
              {seg.speaker && (
                <Chip
                  icon={<PersonIcon sx={{ fontSize: 12 }} />}
                  label={seg.speaker}
                  size="small"
                  variant="outlined"
                  sx={{ height: 16, fontSize: 10 }}
                />
              )}
              {seg.ai_edited && (
                <Chip
                  label="AI"
                  size="small"
                  color="info"
                  variant="outlined"
                  sx={{ height: 16, fontSize: 10 }}
                />
              )}
            </Box>
          </Box>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontSize: 12,
                color: "text.secondary",
                whiteSpace: "pre-wrap",
              }}
            >
              {seg.text}
            </Typography>
            <TextField
              size="small"
              variant="outlined"
              placeholder="telop_text (空欄なら text を使用)"
              fullWidth
              value={seg.telop_text ?? ""}
              onChange={(e) =>
                updateSegment(seg.id, {
                  telop_text: e.target.value === "" ? null : e.target.value,
                })
              }
              slotProps={{ htmlInput: { style: { fontSize: 13 } } }}
            />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
