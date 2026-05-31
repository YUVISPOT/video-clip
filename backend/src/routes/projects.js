'use strict';

const express = require('express');
const { db } = require('../utils/db');

const router = express.Router();

router.get('/', (req, res) => {
  const projects = db.findProjects().map(p => ({
    ...p,
    _count: {
      clips: db.findClips({ projectId: p.id }).length,
    },
  }));
  res.json({ projects });
});

router.post('/', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const project = db.createProject({ name, description: description || null });
  res.status(201).json({ project });
});

router.get('/:id', (req, res) => {
  const project = db.findProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

router.patch('/:id', (req, res) => {
  const { name, description } = req.body;
  const project = db.updateProject(req.params.id, { name, description });
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

router.delete('/:id', (req, res) => {
  db.deleteProject(req.params.id);
  res.json({ success: true });
});

router.post('/:id/timeline', (req, res) => {
  const { name = 'Main Timeline' } = req.body;
  const project = db.findProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const timeline = db.createTimeline({ projectId: req.params.id, name });
  res.status(201).json({ timeline });
});

router.get('/:id/timeline/:tid', (req, res) => {
  const timeline = db.findTimeline(req.params.tid);
  if (!timeline) return res.status(404).json({ error: 'Timeline not found' });
  res.json({ timeline });
});

router.post('/:id/timeline/:tid/items', (req, res) => {
  const { clipId, position, startTime, endTime, trackIndex = 0,
          volume = 1.0, playbackRate = 1.0, zoomFactor = 1.0,
          cropX, cropY, cropW, cropH } = req.body;
  if (!clipId || position === undefined || startTime === undefined || endTime === undefined)
    return res.status(400).json({ error: 'clipId, position, startTime, endTime required' });

  const clip = db.findClip(clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const item = db.createTimelineItem({
    timelineId: req.params.tid, clipId,
    position: parseFloat(position),
    startTime: parseFloat(startTime),
    endTime: parseFloat(endTime),
    trackIndex: parseInt(trackIndex),
    volume: parseFloat(volume),
    playbackRate: parseFloat(playbackRate),
    zoomFactor: parseFloat(zoomFactor),
    cropX: cropX != null ? parseFloat(cropX) : null,
    cropY: cropY != null ? parseFloat(cropY) : null,
    cropW: cropW != null ? parseFloat(cropW) : null,
    cropH: cropH != null ? parseFloat(cropH) : null,
  });
  res.status(201).json({ item });
});

router.patch('/:id/timeline/:tid/items/:itemId', (req, res) => {
  const item = db.updateTimelineItem(req.params.itemId, req.body);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ item });
});

router.delete('/:id/timeline/:tid/items/:itemId', (req, res) => {
  db.deleteTimelineItem(req.params.itemId);
  res.json({ success: true });
});

module.exports = router;
