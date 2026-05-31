# VideoClip Studio

A real, fully working video clipping and rendering app powered by FFmpeg. No mock data, no fake exports — every MP4 output is a genuinely encoded video.

## Requirements

- **Node.js** 18+
- **FFmpeg** with libx264 and AAC support: `ffmpeg -encoders | grep libx264`
- npm 8+

## Quick Start

### 1. Install & Start Backend

```bash
cd backend
npm install
npm start
# API running at http://localhost:4000
```

### 2. Install & Start Frontend

```bash
cd frontend
npm install
npm run dev
# UI running at http://localhost:3000
```

Open http://localhost:3000 in your browser.

---

## Features

### ✅ Real FFmpeg Pipeline
- **Trim** — cut any clip to exact in/out points with libx264
- **Concatenate** — join multiple clips into one seamless video
- **Montage** — multi-clip montage builder with per-clip trimming
- **Aspect ratio conversion** — 16:9 → 9:16 vertical with blur background
- **Zoom** — zoompan filter for digital zoom effects
- **Crop** — crop to any region
- **Captions** — drawtext overlay with configurable position/style
- **SRT subtitles** — burn in subtitles from .srt files
- **Webcam PiP** — picture-in-picture overlay
- **Audio ducking** — sidechaincompress for music + voice mixing
- **Highlight detection** — FFmpeg scene detection + energy analysis

### ✅ Export Formats
- **YouTube (16:9)** — 1080p/4K H.264
- **TikTok/Reels/Shorts (9:16)** — 1080×1920 vertical
- **Square (1:1)** — Instagram
- **Portrait (4:5)** — Instagram Feed

### ✅ Real Backend
- Streaming uploads up to 4GB with progress tracking
- Job queue (2 concurrent renders, queued otherwise)
- WebSocket live progress updates
- Per-file validation — duration, codec, stream check
- Auto thumbnail + waveform generation
- JSON file database (no binary native modules required)
- Temp file cleanup

### ✅ Output Validation
Every render is validated with `ffprobe` after completion:
- File exists and is > 1KB
- Contains a valid video stream
- Duration is positive
- Codec is a known video codec
- Rejects corrupt output and reports error instead of fake success

---

## API Reference

### Upload
```
POST /api/upload          multipart/form-data, field: video
GET  /api/upload          list all clips
DELETE /api/upload/:id    delete clip + file
```

### Clips
```
GET  /api/clips           list clips
GET  /api/clips/:id       get clip + renders
POST /api/clips/:id/trim  { startTime, endTime }
POST /api/clips/:id/highlights { minDuration, maxClips }
```

### Export
```
POST /api/export/clip     { clipId, startTime, endTime, targetAspect, captions, zoom }
POST /api/export/montage  { clips:[{clipId,startTime,endTime}], width, height, fps }
POST /api/export/short    { clipId, startTime, endTime, targetAspect }
GET  /api/export/jobs     list all export jobs
GET  /api/export/jobs/:id job status
```

### Renders
```
GET  /api/renders             list all renders
GET  /api/renders/:id         get render + clip
GET  /api/renders/:id/download stream MP4 file
POST /api/renders/:id/validate check output validity
```

### Projects
```
GET    /api/projects           list
POST   /api/projects           create { name, description }
GET    /api/projects/:id       with clips, timelines, jobs
PATCH  /api/projects/:id       update name/description
DELETE /api/projects/:id       delete

POST   /api/projects/:id/timeline            create timeline
GET    /api/projects/:id/timeline/:tid       get timeline + items
POST   /api/projects/:id/timeline/:tid/items add clip to timeline
PATCH  /api/projects/:id/timeline/:tid/items/:itemId update item
DELETE /api/projects/:id/timeline/:tid/items/:itemId remove item
```

### WebSocket — ws://localhost:4000/ws
Events emitted:
```
{ type: "queue_state", jobs: [...] }
{ type: "job:queued",   jobId, job }
{ type: "job:started",  jobId, job }
{ type: "job:progress", jobId, progress, message }
{ type: "job:done",     jobId, result }
{ type: "job:error",    jobId, error }
{ type: "job:cancelled",jobId }
```

---

## Data Storage

All data is stored in `backend/prisma/dev.db.json` — a plain JSON file. No Prisma binary, no SQLite native module required. Safe to backup, inspect, or migrate.

Uploaded files: `backend/uploads/`
Rendered outputs: `backend/renders/`
Thumbnails/waveforms: `backend/thumbnails/`
Temp files: `backend/temp/` (auto-cleaned every 30 min)

---

## FFmpeg Commands Used

| Feature | FFmpeg Filter/Flag |
|---|---|
| Trim | `-ss {start} -t {dur} -c:v libx264 -c:a aac` |
| Concat | `-f concat -safe 0 -i list.txt` |
| 9:16 conversion | `boxblur=20:5` bg + `overlay=(W-w)/2:(H-h)/2` |
| Zoom | `zoompan=z={factor}:s=hd1080` |
| Crop | `crop=W:H:X:Y` |
| Captions | `drawtext=text=...:enable='between(t,{s},{e})'` |
| SRT subtitles | `subtitles=file.srt:force_style=...` |
| Webcam PiP | `[1:v]scale=iw*0.25:ih*0.25[pip]; overlay=W-w-10:H-h-10` |
| Audio ducking | `sidechaincompress=threshold=0.02:ratio=4` |
| Thumbnail | `scale=320:180 -frames:v 1` |
| Waveform | `showwavespic=s=800x120:colors=#6366f1` |
| Highlights | `select=gt(scene\,0.3),metadata=print` |
