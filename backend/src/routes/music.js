'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../utils/db');
const { buildMusicEdit, detectBeats } = require('../processors/music-edit');
const { validateOutputFile, RENDERS_DIR, TEMP_DIR } = require('../processors/ffmpeg-pipeline');
const { queue } = require('../processors/job-queue');

const router = express.Router();

const MUSIC_DIR = path.join(__dirname, '../../music');
if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

const ALLOWED_AUDIO = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus'];

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MUSIC_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    cb(null, `${uuidv4()}${ext}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_AUDIO.includes(ext)) return cb(null, true);
    const audioMimes = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/aac'];
    if (audioMimes.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported audio type: ${file.mimetype}`));
  },
});

/**
 * POST /api/music/upload
 * Upload an audio file. Returns { song: { id, filename, originalName, filePath, duration? } }
 */
router.post('/upload', audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });

  // Optionally probe duration using ffprobe
  const filePath = req.file.path;
  let duration = null;
  try {
    const ffmpeg = require('fluent-ffmpeg');
    duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, meta) => {
        if (err || !meta?.format?.duration) return resolve(null);
        resolve(parseFloat(meta.format.duration));
      });
    });
  } catch {}

  // Store in a simple in-memory/JSON song list (reuse db pattern)
  const song = {
    id: uuidv4(),
    filename: req.file.filename,
    originalName: req.file.originalname,
    filePath,
    fileSize: req.file.size,
    duration,
    createdAt: new Date().toISOString(),
  };

  // Persist songs list in the same db file
  if (!db._data.songs) db._data.songs = [];
  db._data.songs.push(song);
  db._save();

  res.json({ song });
});

/**
 * GET /api/music/songs
 * List uploaded songs.
 */
router.get('/songs', (req, res) => {
  const songs = db._data.songs || [];
  res.json({ songs: songs.slice().reverse() });
});

/**
 * DELETE /api/music/songs/:id
 */
router.delete('/songs/:id', (req, res) => {
  if (!db._data.songs) return res.status(404).json({ error: 'Not found' });
  const song = db._data.songs.find(s => s.id === req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  if (fs.existsSync(song.filePath)) { try { fs.unlinkSync(song.filePath); } catch {} }
  db._data.songs = db._data.songs.filter(s => s.id !== req.params.id);
  db._save();
  res.json({ success: true });
});

/**
 * POST /api/music/analyze
 * Just analyze a song — return BPM and beats without building edit.
 * Body: { songId }
 */
router.post('/analyze', async (req, res) => {
  const { songId } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });
  const songs = db._data.songs || [];
  const song = songs.find(s => s.id === songId);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  if (!fs.existsSync(song.filePath)) return res.status(410).json({ error: 'Audio file missing' });

  try {
    const beatData = await detectBeats(song.filePath);
    res.json({ beatData, song });
  } catch (err) {
    res.status(500).json({ error: `Beat analysis failed: ${err.message}` });
  }
});

/**
 * POST /api/music/edit
 * Build a beat-synced music video edit.
 * Body: {
 *   songId,
 *   clipIds: [...],
 *   cutRate: 'beat' | 'half' | 'bar' | 'double',
 *   targetDuration: 60,
 *   duckOriginal: false,
 *   targetAspect: '16:9',
 *   width: 1920, height: 1080, fps: 30
 * }
 */
router.post('/edit', async (req, res) => {
  const {
    songId,
    clipIds = [],
    cutRate = 'bar',
    targetDuration = null,
    duckOriginal = false,
    targetAspect = '16:9',
    width = 1920,
    height = 1080,
    fps = 30,
  } = req.body;

  if (!songId) return res.status(400).json({ error: 'songId required' });
  if (!clipIds.length) return res.status(400).json({ error: 'clipIds required' });

  const songs = db._data.songs || [];
  const song = songs.find(s => s.id === songId);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  if (!fs.existsSync(song.filePath)) return res.status(410).json({ error: 'Audio file missing' });

  // Validate clips
  const clipObjects = [];
  for (const id of clipIds) {
    const c = db.findClip(id);
    if (!c) return res.status(404).json({ error: `Clip not found: ${id}` });
    if (!fs.existsSync(c.filePath)) return res.status(410).json({ error: `File missing: ${id}` });
    clipObjects.push({ path: c.filePath, duration: c.duration, name: c.originalName });
  }

  const outputName = `music_edit_${uuidv4()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputName);

  const job = db.createExportJob({
    type: 'music-edit',
    status: 'pending',
    inputClips: JSON.stringify(clipIds),
    outputFormat: 'mp4',
    aspectRatio: targetAspect,
    resolution: `${width}x${height}`,
    fps: parseFloat(fps),
    videoBitrate: '8000k',
    audioBitrate: '192k',
    preset: cutRate,
  });

  queue.add(async (onProgress) => {
    db.updateExportJob(job.id, { status: 'running' });

    let finalOutputPath = outputPath;

    // If 9:16 is requested, render at 16:9 first then convert
    let renderW = parseInt(width), renderH = parseInt(height);
    const tmpBeforeAR = targetAspect !== '16:9'
      ? path.join(RENDERS_DIR, `_tmp_ar_${uuidv4()}.mp4`)
      : null;

    if (tmpBeforeAR) {
      // Render at landscape, convert after
      finalOutputPath = tmpBeforeAR;
      renderW = 1920; renderH = 1080;
    }

    const meta = await buildMusicEdit({
      songPath: song.filePath,
      clips: clipObjects,
      outputPath: finalOutputPath,
      cutRate,
      targetDuration: targetDuration ? parseFloat(targetDuration) : null,
      duckOriginal,
      width: renderW,
      height: renderH,
      fps: parseInt(fps),
      TEMP_DIR,
    }, (p, msg) => {
      onProgress(p, msg);
      db.updateExportJob(job.id, { progress: p });
    });

    // Convert aspect ratio if needed
    if (tmpBeforeAR && fs.existsSync(tmpBeforeAR)) {
      onProgress(97, `Converting to ${targetAspect}...`);
      const { convertAspectRatio } = require('../processors/ffmpeg-pipeline');
      await convertAspectRatio(tmpBeforeAR, outputPath, targetAspect);
      try { fs.unlinkSync(tmpBeforeAR); } catch {}
    }

    const validated = await validateOutputFile(outputPath);

    db.updateExportJob(job.id, {
      status: 'done',
      progress: 100,
      outputPath: `/renders/${outputName}`,
      fileSize: validated.fileSize,
      duration: validated.duration,
      codec: validated.codec,
    });

    return {
      jobId: job.id,
      outputPath: `/renders/${outputName}`,
      duration: validated.duration,
      bpm: meta.bpm,
      segmentsUsed: meta.segmentsUsed,
      cutRate: meta.cutRate,
    };
  }, job.id);

  res.json({
    exportJob: job,
    message: `Music edit queued — ${song.originalName} × ${clipObjects.length} clip(s) at ${cutRate} cuts`,
  });
});

module.exports = router;
