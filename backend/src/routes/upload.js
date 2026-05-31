'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../utils/db');
const {
  probeVideo, generateThumbnail, generateWaveform,
  UPLOADS_DIR, THUMBNAILS_DIR,
} = require('../processors/ffmpeg-pipeline');

const router = express.Router();

const ALLOWED_EXT = ['.mp4','.mov','.avi','.webm','.mkv','.mpg','.mpeg','.flv','.3gp'];
const MAX_SIZE = 4 * 1024 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXT.includes(ext)) return cb(null, true);
    const videoMimes = ['video/mp4','video/quicktime','video/x-msvideo','video/webm','video/x-matroska','video/mpeg'];
    if (videoMimes.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

router.post('/', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filePath = req.file.path;

  try {
    const meta = await probeVideo(filePath);

    const thumbName = `thumb_${path.basename(filePath, path.extname(filePath))}.jpg`;
    const thumbPath = path.join(THUMBNAILS_DIR, thumbName);
    let thumbnailPath = null;
    try {
      await generateThumbnail(filePath, thumbPath, Math.min(1, meta.duration * 0.1));
      thumbnailPath = `/thumbnails/${thumbName}`;
    } catch (e) { console.warn('Thumbnail failed:', e.message); }

    let waveformPath = null;
    if (meta.hasAudio) {
      const waveName = `wave_${path.basename(filePath, path.extname(filePath))}.png`;
      const wavePath = path.join(THUMBNAILS_DIR, waveName);
      try {
        await generateWaveform(filePath, wavePath);
        waveformPath = `/thumbnails/${waveName}`;
      } catch (e) { console.warn('Waveform failed:', e.message); }
    }

    const clip = db.createClip({
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      fps: meta.fps,
      codec: meta.codec,
      fileSize: req.file.size,
      thumbnailPath,
      waveformPath,
      hasAudio: meta.hasAudio,
      status: 'ready',
      projectId: req.body.projectId || null,
    });

    res.json({ clip });
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch {}
    console.error('Upload error:', err.message);
    res.status(422).json({ error: `Invalid video file: ${err.message}` });
  }
});

router.get('/', (req, res) => {
  const { projectId, page = 1, limit = 20 } = req.query;
  const where = projectId ? { projectId } : {};
  const all = db.findClips(where);
  const p = parseInt(page), l = parseInt(limit);
  res.json({ clips: all.slice((p-1)*l, p*l), total: all.length, page: p, limit: l });
});

router.delete('/:id', (req, res) => {
  const clip = db.findClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  for (const fp of [clip.filePath]) {
    if (fp && fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch {} }
  }
  db.deleteClip(req.params.id);
  res.json({ success: true });
});

module.exports = router;
