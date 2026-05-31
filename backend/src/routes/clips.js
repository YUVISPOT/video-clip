'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../utils/db');
const {
  trimClip, detectHighlights, generateThumbnail,
  RENDERS_DIR, THUMBNAILS_DIR,
} = require('../processors/ffmpeg-pipeline');
const { queue } = require('../processors/job-queue');

const router = express.Router();

router.get('/', (req, res) => {
  const { projectId } = req.query;
  const clips = db.findClips(projectId ? { projectId } : {});
  res.json({ clips });
});

router.get('/:id', (req, res) => {
  const clip = db.findClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  const renders = db.findRenders({ clipId: req.params.id });
  res.json({ clip: { ...clip, renders } });
});

router.post('/:id/trim', async (req, res) => {
  const { startTime, endTime } = req.body;
  if (startTime === undefined || endTime === undefined)
    return res.status(400).json({ error: 'startTime and endTime required' });
  if (parseFloat(endTime) <= parseFloat(startTime))
    return res.status(400).json({ error: 'endTime must be greater than startTime' });

  const clip = db.findClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (!fs.existsSync(clip.filePath)) return res.status(410).json({ error: 'Source file missing' });

  const outputName = `trim_${uuidv4()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputName);

  const render = db.createRender({
    clipId: clip.id,
    startTime: parseFloat(startTime),
    endTime: parseFloat(endTime),
    status: 'pending',
    progress: 0,
  });

  queue.add(async (onProgress) => {
    db.updateRender(render.id, { status: 'running' });

    const meta = await trimClip(
      clip.filePath, outputPath,
      parseFloat(startTime), parseFloat(endTime),
      (p) => { onProgress(p, `Trimming ${p}%`); db.updateRender(render.id, { progress: p }); }
    );

    const thumbName = `thumb_render_${render.id}.jpg`;
    try {
      await generateThumbnail(outputPath, path.join(THUMBNAILS_DIR, thumbName), 1);
    } catch {}

    db.updateRender(render.id, {
      status: 'done', progress: 100,
      filePath: outputPath, fileSize: meta.fileSize,
      duration: meta.duration, outputPath: `/renders/${outputName}`,
    });

    return { renderId: render.id, outputPath: `/renders/${outputName}`, duration: meta.duration };
  }, render.id);

  res.json({ render, message: 'Trim job queued' });
});

router.post('/:id/highlights', async (req, res) => {
  const { minDuration = 5, maxClips = 10 } = req.body;
  const clip = db.findClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (!fs.existsSync(clip.filePath)) return res.status(410).json({ error: 'Source file missing' });

  try {
    const highlights = await detectHighlights(clip.filePath, parseFloat(minDuration), parseInt(maxClips));
    res.json({ highlights });
  } catch (err) {
    res.status(500).json({ error: `Highlight detection failed: ${err.message}` });
  }
});

router.get('/:id/renders', (req, res) => {
  const renders = db.findRenders({ clipId: req.params.id });
  res.json({ renders });
});

router.delete('/:id', (req, res) => {
  const clip = db.findClip(req.params.id);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (clip.filePath && fs.existsSync(clip.filePath)) { try { fs.unlinkSync(clip.filePath); } catch {} }
  db.deleteClip(req.params.id);
  res.json({ success: true });
});

module.exports = router;
