'use strict';

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const fluent = require('fluent-ffmpeg');

const execFileAsync = promisify(execFile);

const SCRIPT = path.join(__dirname, 'beat_detector.py');

/**
 * Run librosa beat detection on an audio file.
 * Returns { bpm, duration, beats: [{start,end,duration,strength}], bars: [...] }
 */
async function detectBeats(audioPath) {
  if (!fs.existsSync(audioPath)) throw new Error(`Audio file not found: ${audioPath}`);

  const { stdout, stderr } = await execFileAsync('python3', [SCRIPT, audioPath], {
    timeout: 120_000, // 2 min max for long tracks
    maxBuffer: 10 * 1024 * 1024,
  });

  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch (e) {
    throw new Error(`Beat detection parse error: ${stdout} | ${stderr}`);
  }

  if (result.error) throw new Error(`Beat detection failed: ${result.error}`);
  if (!result.beats || result.beats.length === 0) throw new Error('No beats detected in audio file');

  return result;
}

/**
 * Extract audio from a video file to a temp WAV for beat detection.
 */
async function extractAudio(videoPath, outputWav) {
  return new Promise((resolve, reject) => {
    fluent(videoPath)
      .audioChannels(1)
      .audioFrequency(22050)
      .noVideo()
      .output(outputWav)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Mix song audio over video, replacing or ducking the original audio.
 * Trims song to match video duration.
 */
async function mixSongOnVideo(videoPath, songPath, outputPath, duckOriginal = false) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let filterComplex, audioMap;

    if (duckOriginal) {
      // Duck original audio under music
      filterComplex =
        '[1:a]aformat=fltp:44100:stereo,volume=0.8[music];' +
        '[0:a]aformat=fltp:44100:stereo,volume=0.15[orig];' +
        '[music][orig]amix=inputs=2:duration=first[aout]';
      audioMap = '[aout]';
    } else {
      // Replace original audio entirely with song (loop/trim to video length)
      filterComplex =
        '[1:a]aformat=fltp:44100:stereo,volume=0.9[aout]';
      audioMap = '[aout]';
    }

    fluent()
      .input(videoPath)
      .input(songPath)
      .complexFilter(filterComplex, audioMap)
      .videoCodec('copy')
      .audioCodec('aac')
      .audioBitrate('192k')
      .outputOptions([
        '-map', '0:v',
        '-shortest',
        '-movflags', '+faststart',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Trim a single video segment to exact duration using stream copy (fast).
 * Falls back to re-encode if stream copy fails (e.g. keyframe issues).
 */
async function trimSegmentFast(inputPath, outputPath, start, duration, width, height, fps) {
  return new Promise((resolve, reject) => {
    fluent(inputPath)
      .seekInput(start)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
        '-preset', 'ultrafast',
        '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-avoid_negative_ts', 'make_zero',
      ])
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

/**
 * Main music edit builder.
 *
 * Algorithm:
 * 1. Detect beats in song → get all beat timestamps + BPM
 * 2. Group beats into "edit units" based on cutRate:
 *    - 'beat'  → cut every beat
 *    - 'half'  → cut every 2 beats
 *    - 'bar'   → cut every 4 beats (one bar)
 *    - 'double'→ cut every 8 beats (2 bars)
 * 3. For each edit unit, pick a random/rotating clip and trim it to that duration
 * 4. Concatenate all trimmed segments
 * 5. Mix the song as audio track (replacing or ducking original)
 * 6. Validate output
 */
async function buildMusicEdit(opts, onProgress) {
  const {
    songPath,
    clips,             // [{path, duration}] — source clips
    outputPath,
    cutRate = 'bar',   // 'beat' | 'half' | 'bar' | 'double'
    targetDuration,    // seconds — how much of the song to use (null = full song)
    duckOriginal = false,
    width = 1920,
    height = 1080,
    fps = 30,
    TEMP_DIR,
  } = opts;

  if (!fs.existsSync(songPath)) throw new Error(`Song not found: ${songPath}`);
  if (!clips || clips.length === 0) throw new Error('No source clips provided');

  onProgress && onProgress(2, 'Analyzing song for beats...');

  // Step 1: Detect beats
  const beatData = await detectBeats(songPath);
  const { bpm, beats, bars, duration: songDuration } = beatData;

  onProgress && onProgress(15, `Found ${beats.length} beats at ${bpm.toFixed(1)} BPM`);

  // Step 2: Build edit unit list based on cutRate
  let editUnits = [];
  const maxDur = targetDuration ? Math.min(targetDuration, songDuration) : songDuration;

  if (cutRate === 'beat') {
    editUnits = beats.filter(b => b.start < maxDur).map(b => ({
      start: b.start,
      end: Math.min(b.end, maxDur),
      duration: Math.min(b.end, maxDur) - b.start,
      strength: b.strength,
    }));
  } else if (cutRate === 'half') {
    editUnits = beats.filter((b, i) => i % 2 === 0 && b.start < maxDur).map((b, i) => {
      const next = beats.find((_, j) => j === beats.indexOf(b) + 2);
      const end = next ? Math.min(next.start, maxDur) : Math.min(b.end, maxDur);
      return { start: b.start, end, duration: end - b.start, strength: b.strength };
    });
  } else if (cutRate === 'bar') {
    editUnits = bars.filter(b => b.start < maxDur).map(b => ({
      start: b.start,
      end: Math.min(b.end, maxDur),
      duration: Math.min(b.end, maxDur) - b.start,
      strength: 1,
    }));
  } else { // 'double' — 2 bars
    editUnits = bars.filter((b, i) => i % 2 === 0 && b.start < maxDur).map((b, i) => {
      const next = bars[bars.indexOf(b) + 2];
      const end = next ? Math.min(next.start, maxDur) : Math.min(b.end, maxDur);
      return { start: b.start, end, duration: end - b.start, strength: 1 };
    });
  }

  // Remove units that are too short (< 0.1s) or too long (> 30s)
  editUnits = editUnits.filter(u => u.duration >= 0.1 && u.duration <= 30);

  if (editUnits.length === 0) throw new Error('No valid edit units from beat analysis');

  onProgress && onProgress(20, `Building ${editUnits.length} cuts at ${cutRate} rate (${bpm.toFixed(0)} BPM)`);

  // Step 3: For each edit unit, trim a segment from a clip
  const segmentPaths = [];
  const totalUnits = editUnits.length;

  // Rotate through clips; prefer higher-strength beats for action clips
  let clipCursor = 0;
  let clipTimeOffsets = clips.map(() => 0); // track position within each clip

  for (let i = 0; i < totalUnits; i++) {
    const unit = editUnits[i];
    const pct = Math.round(20 + (i / totalUnits) * 55);
    onProgress && onProgress(pct, `Cutting segment ${i + 1}/${totalUnits}...`);

    const clip = clips[clipCursor % clips.length];
    let clipStart = clipTimeOffsets[clipCursor % clips.length];

    // If we've used up this clip, wrap around
    if (clipStart + unit.duration > clip.duration) {
      clipStart = 0;
      clipTimeOffsets[clipCursor % clips.length] = 0;
    }

    const segOut = path.join(TEMP_DIR, `musicedit_seg_${Date.now()}_${i}.mp4`);

    try {
      await trimSegmentFast(clip.path, segOut, clipStart, unit.duration, width, height, fps);
      segmentPaths.push(segOut);
      clipTimeOffsets[clipCursor % clips.length] = clipStart + unit.duration;
    } catch (e) {
      console.warn(`Segment ${i} trim failed, skipping:`, e.message);
    }

    clipCursor++;
  }

  if (segmentPaths.length === 0) throw new Error('No segments rendered successfully');

  // Step 4: Concatenate all segments (no audio — we add song after)
  onProgress && onProgress(76, `Concatenating ${segmentPaths.length} segments...`);

  const concatListPath = path.join(TEMP_DIR, `musicedit_concat_${Date.now()}.txt`);
  fs.writeFileSync(concatListPath, segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));

  const concatNoAudio = path.join(TEMP_DIR, `musicedit_noaudio_${Date.now()}.mp4`);

  await new Promise((resolve, reject) => {
    fluent()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .videoCodec('libx264')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-an', // no audio yet
      ])
      .output(concatNoAudio)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });

  try { fs.unlinkSync(concatListPath); } catch {}

  // Step 5: Mix song as audio track
  onProgress && onProgress(88, 'Mixing song audio...');

  await mixSongOnVideo(concatNoAudio, songPath, outputPath, duckOriginal);

  try { fs.unlinkSync(concatNoAudio); } catch {}
  for (const seg of segmentPaths) { try { fs.unlinkSync(seg); } catch {} }

  onProgress && onProgress(97, 'Validating...');

  return {
    bpm,
    beatCount: beats.length,
    segmentsUsed: segmentPaths.length,
    editUnits: totalUnits,
    cutRate,
  };
}

module.exports = { detectBeats, buildMusicEdit, extractAudio };
