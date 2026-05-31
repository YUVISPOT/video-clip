'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../utils/db');
const { queue } = require('../processors/job-queue');
const { validateOutputFile, RENDERS_DIR } = require('../processors/ffmpeg-pipeline');

const router = express.Router();

router.get('/queue/status', (req, res) => res.json({ jobs: queue.list() }));

router.get('/', (req, res) => {
  const renders = db.findRenders({}).map(r => ({ ...r, clip: db.findClip(r.clipId) }));
  res.json({ renders });
});

router.get('/:id', (req, res) => {
  const render = db.findRender(req.params.id);
  if (!render) return res.status(404).json({ error: 'Render not found' });
  const live = queue.get(req.params.id);
  res.json({ render: { ...render, clip: db.findClip(render.clipId) }, liveProgress: live?.progress ?? null });
});

router.get('/:id/download', (req, res) => {
  const render = db.findRender(req.params.id);
  if (!render) return res.status(404).json({ error: 'Render not found' });
  if (render.status !== 'done') return res.status(409).json({ error: `Render is ${render.status}` });
  if (!render.filePath || !fs.existsSync(render.filePath))
    return res.status(410).json({ error: 'File not found on disk' });
  const stat = fs.statSync(render.filePath);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="clip_${render.id}.mp4"`);
  fs.createReadStream(render.filePath).pipe(res);
});

router.post('/:id/validate', async (req, res) => {
  const render = db.findRender(req.params.id);
  if (!render) return res.status(404).json({ error: 'Render not found' });
  if (!render.filePath) return res.status(409).json({ error: 'No output file yet' });
  try {
    const meta = await validateOutputFile(render.filePath);
    res.json({ valid: true, meta });
  } catch (err) {
    res.json({ valid: false, error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const render = db.findRender(req.params.id);
  if (!render) return res.status(404).json({ error: 'Render not found' });
  queue.cancel(req.params.id);
  if (render.filePath && fs.existsSync(render.filePath)) { try { fs.unlinkSync(render.filePath); } catch {} }
  db.deleteRender(req.params.id);
  res.json({ success: true });
});

module.exports = router;
