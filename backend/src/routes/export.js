'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../utils/db');
const {
  renderClip, generateMontage, convertAspectRatio,
  trimClip, validateOutputFile, RENDERS_DIR,
} = require('../processors/ffmpeg-pipeline');
const { queue } = require('../processors/job-queue');

const router = express.Router();

// POST /api/export/clip
router.post('/clip', async (req, res) => {
  const {
    clipId, startTime = 0, endTime,
    targetAspect = '16:9',
    captions = [], zoom = null, cropParams = null,
    videoBitrate = '8000k', audioBitrate = '192k', preset = 'medium',
  } = req.body;

  if (!clipId) return res.status(400).json({ error: 'clipId required' });
  const clip = db.findClip(clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (!fs.existsSync(clip.filePath)) return res.status(410).json({ error: 'Source file missing' });

  const outputName = `export_${uuidv4()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputName);

  const job = db.createExportJob({
    type: 'clip', status: 'pending',
    inputClips: JSON.stringify([clipId]),
    outputFormat: 'mp4', aspectRatio: targetAspect,
    videoBitrate, audioBitrate, preset,
  });

  queue.add(async (onProgress) => {
    db.updateExportJob(job.id, { status: 'running' });
    const meta = await renderClip({
      inputPath: clip.filePath, outputPath,
      startTime: parseFloat(startTime),
      endTime: endTime ? parseFloat(endTime) : clip.duration,
      targetAspect, captions,
      zoom: zoom ? parseFloat(zoom) : null,
      cropParams,
    }, (p, msg) => {
      onProgress(p, msg);
      db.updateExportJob(job.id, { progress: p });
    });

    db.updateExportJob(job.id, {
      status: 'done', progress: 100,
      outputPath: `/renders/${outputName}`,
      fileSize: meta.fileSize, duration: meta.duration, codec: meta.codec,
    });
    return { jobId: job.id, outputPath: `/renders/${outputName}`, duration: meta.duration };
  }, job.id);

  res.json({ exportJob: job, message: 'Export queued' });
});

// POST /api/export/montage
router.post('/montage', async (req, res) => {
  const {
    clips: clipDefs = [],
    width = 1920, height = 1080, fps = 30,
    videoBitrate = '8000k', audioBitrate = '192k',
  } = req.body;

  if (!clipDefs.length) return res.status(400).json({ error: 'clips array required' });

  const clipMap = {};
  for (const def of clipDefs) {
    const c = db.findClip(def.clipId);
    if (!c) return res.status(404).json({ error: `Clip not found: ${def.clipId}` });
    if (!fs.existsSync(c.filePath)) return res.status(410).json({ error: `File missing: ${def.clipId}` });
    clipMap[def.clipId] = c;
  }

  const outputName = `montage_${uuidv4()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputName);

  const job = db.createExportJob({
    type: 'montage', status: 'pending',
    inputClips: JSON.stringify(clipDefs.map(c => c.clipId)),
    resolution: `${width}x${height}`, fps: parseFloat(fps),
    videoBitrate, audioBitrate,
  });

  queue.add(async (onProgress) => {
    db.updateExportJob(job.id, { status: 'running' });
    const clipsInput = clipDefs.map(def => ({
      path: clipMap[def.clipId].filePath,
      startTime: def.startTime || 0,
      endTime: def.endTime || clipMap[def.clipId].duration,
    }));

    await generateMontage(clipsInput, outputPath, {
      width: parseInt(width), height: parseInt(height),
      fps: parseFloat(fps), videoBitrate, audioBitrate,
    }, (p, msg) => {
      onProgress(p, msg);
      db.updateExportJob(job.id, { progress: p });
    });

    const meta = await validateOutputFile(outputPath);
    db.updateExportJob(job.id, {
      status: 'done', progress: 100,
      outputPath: `/renders/${outputName}`,
      fileSize: meta.fileSize, duration: meta.duration, codec: meta.codec,
    });
    return { jobId: job.id, outputPath: `/renders/${outputName}` };
  }, job.id);

  res.json({ exportJob: job, message: 'Montage queued' });
});

// POST /api/export/short
router.post('/short', async (req, res) => {
  const { clipId, startTime = 0, endTime, targetAspect = '9:16' } = req.body;
  if (!clipId) return res.status(400).json({ error: 'clipId required' });
  const clip = db.findClip(clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (!fs.existsSync(clip.filePath)) return res.status(410).json({ error: 'Source file missing' });

  const outputName = `short_${uuidv4()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputName);

  const job = db.createExportJob({
    type: 'short', status: 'pending',
    inputClips: JSON.stringify([clipId]),
    aspectRatio: targetAspect, resolution: '1080x1920', fps: 30,
    videoBitrate: '6000k', audioBitrate: '192k',
  });

  queue.add(async (onProgress) => {
    db.updateExportJob(job.id, { status: 'running' });
    const st = parseFloat(startTime);
    const et = endTime ? parseFloat(endTime) : clip.duration;
    let inputPath = clip.filePath;
    const tmpPath = path.join(RENDERS_DIR, `_tmp_${uuidv4()}.mp4`);
    let trimmed = false;

    if (st > 0 || et < clip.duration) {
      await trimClip(inputPath, tmpPath, st, et, (p) => {
        onProgress(p * 0.4, `Trimming ${p}%`);
        db.updateExportJob(job.id, { progress: Math.round(p * 0.4) });
      });
      inputPath = tmpPath;
      trimmed = true;
    }

    await convertAspectRatio(inputPath, outputPath, targetAspect, (p) => {
      onProgress(40 + p * 0.6, `Converting ${targetAspect}: ${p}%`);
      db.updateExportJob(job.id, { progress: Math.round(40 + p * 0.6) });
    });

    if (trimmed) { try { fs.unlinkSync(tmpPath); } catch {} }

    const meta = await validateOutputFile(outputPath);
    db.updateExportJob(job.id, {
      status: 'done', progress: 100,
      outputPath: `/renders/${outputName}`,
      fileSize: meta.fileSize, duration: meta.duration, codec: meta.codec,
    });
    return { jobId: job.id, outputPath: `/renders/${outputName}` };
  }, job.id);

  res.json({ exportJob: job, message: 'Short export queued' });
});

router.get('/jobs', (req, res) => {
  const jobs = db.findExportJobs({});
  res.json({ jobs });
});

router.get('/jobs/:id', (req, res) => {
  const job = db.findExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const live = queue.get(req.params.id);
  res.json({ job, liveStatus: live || null });
});

router.delete('/jobs/:id', (req, res) => {
  const job = db.findExportJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  queue.cancel(req.params.id);
  if (job.outputPath) {
    const abs = path.join(RENDERS_DIR, path.basename(job.outputPath));
    if (fs.existsSync(abs)) { try { fs.unlinkSync(abs); } catch {} }
  }
  db.deleteExportJob(req.params.id);
  res.json({ success: true });
});

module.exports = router;

/**
 * POST /api/export/auto-montage
 * Fully automatic: detect highlights from one or more clips,
 * rank them by score, trim each, concatenate into one MP4.
 * Body: {
 *   clipIds: [id, ...],
 *   targetDuration: 60,        // desired output length in seconds
 *   targetAspect: '16:9',
 *   minHighlightDuration: 3,
 *   maxHighlightDuration: 15,
 *   width: 1920, height: 1080, fps: 30
 * }
 */
router.post('/auto-montage', async (req, res) => {
  const {
    clipIds = [],
    targetDuration = 60,
    targetAspect = '16:9',
    minHighlightDuration = 3,
    maxHighlightDuration = 15,
    width = 1920,
    height = 1080,
    fps = 30,
    videoBitrate = '8000k',
    audioBitrate = '192k',
  } = req.body;

  if (!clipIds.length) return res.status(400).json({ error: 'clipIds array required' });

  // Validate all clips exist
  const clips = [];
  for (const id of clipIds) {
    const c = db.findClip(id);
    if (!c) return res.status(404).json({ error: `Clip not found: ${id}` });
    if (!fs.existsSync(c.filePath)) return res.status(410).json({ error: `File missing: ${id}` });
    clips.push(c);
  }

  const outputName = `auto_montage_${uuidv4()}.mp4`;
  const outputPath = path.join(RENDERS_DIR, outputName);

  const job = db.createExportJob({
    type: 'auto-montage',
    status: 'pending',
    inputClips: JSON.stringify(clipIds),
    outputFormat: 'mp4',
    aspectRatio: targetAspect,
    resolution: `${width}x${height}`,
    fps: parseFloat(fps),
    videoBitrate,
    audioBitrate,
  });

  queue.add(async (onProgress) => {
    db.updateExportJob(job.id, { status: 'running' });

    const { detectHighlights } = require('../processors/ffmpeg-pipeline');

    // Step 1: detect highlights from every clip
    onProgress(2, 'Analyzing clips for highlights...');
    let allHighlights = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const pct = Math.round(2 + (i / clips.length) * 28);
      onProgress(pct, `Analyzing clip ${i + 1}/${clips.length}: ${clip.originalName}`);
      db.updateExportJob(job.id, { progress: pct });

      // max clips per source: proportional to targetDuration
      const maxPerClip = Math.ceil(targetDuration / minHighlightDuration);
      let highlights;
      try {
        highlights = await detectHighlights(clip.filePath, minHighlightDuration, maxPerClip);
      } catch (e) {
        // Fallback: segment entire clip evenly
        highlights = [];
        const segLen = Math.min(maxHighlightDuration, clip.duration / 3);
        for (let t = 0; t + minHighlightDuration < clip.duration; t += segLen) {
          highlights.push({ start: t, end: Math.min(t + segLen, clip.duration), score: 0.5, type: 'segment' });
        }
      }

      // Clamp highlight durations and attach source clip
      highlights = highlights
        .map(h => ({
          ...h,
          start: Math.max(0, h.start),
          end: Math.min(clip.duration, h.end),
          clipPath: clip.filePath,
          clipName: clip.originalName,
        }))
        .filter(h => {
          const dur = h.end - h.start;
          return dur >= minHighlightDuration && dur <= maxHighlightDuration;
        });

      allHighlights.push(...highlights);
    }

    if (!allHighlights.length) {
      throw new Error('No usable highlight segments found in the provided clips. Try uploading longer footage.');
    }

    // Step 2: rank by score, then greedily fill targetDuration
    allHighlights.sort((a, b) => b.score - a.score);

    let selected = [];
    let totalSelected = 0;
    for (const h of allHighlights) {
      const dur = h.end - h.start;
      if (totalSelected + dur > targetDuration * 1.15) continue; // allow 15% overshoot
      selected.push(h);
      totalSelected += dur;
      if (totalSelected >= targetDuration) break;
    }

    if (!selected.length) {
      // Just take the top highlight if nothing fit
      selected = [allHighlights[0]];
    }

    // Optionally sort selected by source order for narrative flow
    selected.sort((a, b) => a.start - b.start);

    onProgress(32, `Selected ${selected.length} highlights (${totalSelected.toFixed(1)}s total). Rendering...`);
    db.updateExportJob(job.id, { progress: 32 });

    // Step 3: trim each highlight to a temp file, normalizing resolution
    const { TEMP_DIR } = require('../processors/ffmpeg-pipeline');
    const fluent = require('fluent-ffmpeg');
    const trimmedPaths = [];

    for (let i = 0; i < selected.length; i++) {
      const h = selected[i];
      const dur = h.end - h.start;
      const tmpOut = path.join(TEMP_DIR, `automontage_${job.id}_${i}.mp4`);
      const pct = Math.round(32 + (i / selected.length) * 45);
      onProgress(pct, `Trimming highlight ${i + 1}/${selected.length}...`);
      db.updateExportJob(job.id, { progress: pct });

      await new Promise((resolve, reject) => {
        const cmd = fluent(h.clipPath)
          .seekInput(h.start)
          .duration(dur)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
            '-preset', 'fast',
            '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
          ])
          .output(tmpOut)
          .on('end', resolve)
          .on('error', reject);
        cmd.run();
      });

      trimmedPaths.push(tmpOut);
    }

    // Step 4: concatenate all trimmed highlights
    onProgress(78, 'Concatenating highlights into montage...');
    db.updateExportJob(job.id, { progress: 78 });

    const { concatenateClips, convertAspectRatio, validateOutputFile } = require('../processors/ffmpeg-pipeline');
    let finalPath = outputPath;

    if (targetAspect !== '16:9') {
      // Concat to temp, then convert aspect
      const concatTmp = path.join(TEMP_DIR, `automontage_concat_${job.id}.mp4`);
      await concatenateClips(trimmedPaths, concatTmp, { width, height, fps, videoBitrate, audioBitrate },
        (p) => { onProgress(78 + p * 0.1, 'Concatenating...'); });
      onProgress(88, `Converting to ${targetAspect}...`);
      await convertAspectRatio(concatTmp, outputPath, targetAspect,
        (p) => { onProgress(88 + p * 0.1, 'Converting aspect ratio...'); });
      try { fs.unlinkSync(concatTmp); } catch {}
    } else {
      await concatenateClips(trimmedPaths, outputPath, { width, height, fps, videoBitrate, audioBitrate },
        (p) => { onProgress(78 + p * 0.2, 'Concatenating...'); });
    }

    // Cleanup temp clips
    for (const tmp of trimmedPaths) { try { fs.unlinkSync(tmp); } catch {} }

    onProgress(98, 'Validating output...');
    const meta = await validateOutputFile(outputPath);

    db.updateExportJob(job.id, {
      status: 'done',
      progress: 100,
      outputPath: `/renders/${outputName}`,
      fileSize: meta.fileSize,
      duration: meta.duration,
      codec: meta.codec,
    });

    return {
      jobId: job.id,
      outputPath: `/renders/${outputName}`,
      duration: meta.duration,
      highlightsUsed: selected.length,
      totalDuration: totalSelected,
    };
  }, job.id);

  res.json({
    exportJob: job,
    message: `Auto-montage queued — will analyze ${clips.length} clip(s) and render best ~${targetDuration}s`,
  });
});
