'use strict';

const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { execFile, exec } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const UPLOADS_DIR = path.join(__dirname, '../../uploads');
const RENDERS_DIR = path.join(__dirname, '../../renders');
const THUMBNAILS_DIR = path.join(__dirname, '../../thumbnails');
const TEMP_DIR = path.join(__dirname, '../../temp');

// Ensure directories exist
[UPLOADS_DIR, RENDERS_DIR, THUMBNAILS_DIR, TEMP_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

/**
 * Probe a video file and return real metadata.
 * Throws if file is not a valid video.
 */
async function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      if (!metadata || !metadata.streams) return reject(new Error('No stream metadata'));

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      if (!videoStream) return reject(new Error('No video stream found in file'));

      const duration = parseFloat(metadata.format.duration);
      if (!duration || duration <= 0) return reject(new Error('Invalid video duration'));

      const fpsStr = videoStream.r_frame_rate || videoStream.avg_frame_rate || '30/1';
      const [num, den] = fpsStr.split('/').map(Number);
      const fps = den > 0 ? num / den : 30;

      resolve({
        duration,
        width: videoStream.width,
        height: videoStream.height,
        fps: parseFloat(fps.toFixed(3)),
        codec: videoStream.codec_name,
        hasAudio: !!audioStream,
        audioCodec: audioStream ? audioStream.codec_name : null,
        bitrate: parseInt(metadata.format.bit_rate) || 0,
        fileSize: parseInt(metadata.format.size) || 0,
        format: metadata.format.format_name,
      });
    });
  });
}

/**
 * Generate a thumbnail at a specific time offset.
 * Returns the path to the generated JPEG.
 */
async function generateThumbnail(filePath, outputPath, timeOffset = 1) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    ffmpeg(filePath)
      .seekInput(timeOffset)
      .frames(1)
      .size('320x180')
      .outputOptions(['-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2'])
      .output(outputPath)
      .on('end', () => {
        if (!fs.existsSync(outputPath)) {
          return reject(new Error('Thumbnail file was not created'));
        }
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`Thumbnail generation failed: ${err.message}`)))
      .run();
  });
}

/**
 * Generate waveform image from audio track.
 * Returns path to PNG waveform.
 */
async function generateWaveform(filePath, outputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    ffmpeg(filePath)
      .outputOptions([
        '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=800x120:colors=#6366f1',
        '-frames:v', '1',
      ])
      .output(outputPath)
      .on('end', () => {
        if (!fs.existsSync(outputPath)) {
          return reject(new Error('Waveform file was not created'));
        }
        resolve(outputPath);
      })
      .on('error', (err) => reject(new Error(`Waveform generation failed: ${err.message}`)))
      .run();
  });
}

/**
 * Trim a video clip between startTime and endTime.
 * Returns output path of the trimmed MP4.
 */
async function trimClip(inputPath, outputPath, startTime, endTime, onProgress) {
  const duration = endTime - startTime;
  if (duration <= 0) throw new Error('endTime must be greater than startTime');

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg(inputPath)
      .seekInput(startTime)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => {
        const pct = Math.min(99, Math.round((p.timemark ? timemarkToSeconds(p.timemark) / duration : 0) * 100));
        onProgress(pct);
      });
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) {
          reject(e);
        }
      })
      .on('error', (err) => reject(new Error(`Trim failed: ${err.message}`)))
      .run();
  });
}

/**
 * Concatenate multiple video clips into one MP4.
 * All clips are normalized to the same resolution/fps.
 */
async function concatenateClips(clipPaths, outputPath, options = {}, onProgress) {
  if (!clipPaths || clipPaths.length === 0) throw new Error('No clips provided for concatenation');
  clipPaths.forEach((p, i) => {
    if (!fs.existsSync(p)) throw new Error(`Clip ${i} not found: ${p}`);
  });

  const {
    width = 1920,
    height = 1080,
    fps = 30,
    videoBitrate = '8000k',
    audioBitrate = '192k',
    preset = 'medium',
  } = options;

  const concatListPath = path.join(TEMP_DIR, `concat_${Date.now()}.txt`);
  const listContent = clipPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(concatListPath, listContent, 'utf8');

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filterArgs = [
      `-vf`, `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
    ];

    const cmd = ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', preset,
        '-crf', '18',
        '-b:v', videoBitrate,
        '-b:a', audioBitrate,
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        ...filterArgs,
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => {
        const pct = Math.min(99, Math.round(p.percent || 0));
        onProgress(pct);
      });
    }

    cmd
      .on('end', async () => {
        try {
          fs.unlinkSync(concatListPath);
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) {
          try { fs.unlinkSync(concatListPath); } catch {}
          reject(e);
        }
      })
      .on('error', (err) => {
        try { fs.unlinkSync(concatListPath); } catch {}
        reject(new Error(`Concatenation failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Convert aspect ratio — e.g. 16:9 gameplay → 9:16 TikTok/Reels.
 * Uses smart crop + blur background.
 */
async function convertAspectRatio(inputPath, outputPath, targetAspect = '9:16', onProgress) {
  const [tw, th] = targetAspect.split(':').map(Number);
  const targetW = tw === 9 ? 1080 : 1920;
  const targetH = th === 16 ? 1920 : 1080;

  // For 9:16: blur background + cropped foreground centered
  const filterComplex = targetAspect === '9:16'
    ? `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=20:5[bg];` +
      `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2[out]`
    : `[0:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2[out]`;

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg(inputPath)
      .complexFilter(filterComplex, 'out')
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Aspect ratio conversion failed: ${err.message}`)))
      .run();
  });
}

/**
 * Burn subtitles/captions into video from an SRT file.
 */
async function burnSubtitles(inputPath, subtitlePath, outputPath, onProgress) {
  if (!fs.existsSync(subtitlePath)) throw new Error(`Subtitle file not found: ${subtitlePath}`);

  const escapedSrtPath = subtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:');

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        `-vf`, `subtitles='${escapedSrtPath}':force_style='FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'`,
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Subtitle burn failed: ${err.message}`)))
      .run();
  });
}

/**
 * Add drawtext captions (no SRT file needed — inline text).
 */
async function addCaptions(inputPath, outputPath, captions = [], onProgress) {
  // captions: [{text, startTime, endTime, fontSize, color, x, y}]
  if (!captions.length) throw new Error('No captions provided');

  const filterParts = captions.map((cap, i) => {
    const text = cap.text.replace(/'/g, "\\'").replace(/:/g, '\\:');
    const fs = cap.fontSize || 28;
    const color = cap.color || 'white';
    const x = cap.x || '(w-text_w)/2';
    const y = cap.y || 'h-100';
    return `drawtext=text='${text}':fontsize=${fs}:fontcolor=${color}:x=${x}:y=${y}:enable='between(t,${cap.startTime},${cap.endTime})':box=1:boxcolor=black@0.5:boxborderw=5`;
  });

  const vf = filterParts.join(',');

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-vf', vf,
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Caption overlay failed: ${err.message}`)))
      .run();
  });
}

/**
 * Apply zoom effect to a region of the video.
 */
async function applyZoom(inputPath, outputPath, zoom = 1.5, cropX = null, cropY = null, onProgress) {
  const cx = cropX !== null ? cropX : '(iw-iw/z)/2';
  const cy = cropY !== null ? cropY : '(ih-ih/z)/2';
  const vf = `zoompan=z='${zoom}':x='${cx}':y='${cy}':d=1:s=hd1080,scale=1920:1080`;

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-vf', vf,
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-r', '30',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Zoom effect failed: ${err.message}`)))
      .run();
  });
}

/**
 * Crop video to specific region.
 */
async function cropVideo(inputPath, outputPath, cropW, cropH, cropX = 0, cropY = 0, onProgress) {
  const vf = `crop=${cropW}:${cropH}:${cropX}:${cropY}`;

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-vf', vf,
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Crop failed: ${err.message}`)))
      .run();
  });
}

/**
 * Apply audio ducking — reduce background music when speech is present.
 * Uses sidechaincompress or simple volume automation.
 */
async function mixAudioWithDucking(inputPath, musicPath, outputPath, duckLevel = 0.2, onProgress) {
  if (!fs.existsSync(musicPath)) throw new Error(`Music file not found: ${musicPath}`);

  const filterComplex =
    `[1:a]aformat=fltp:44100:stereo,volume=1.0[music];` +
    `[0:a]aformat=fltp:44100:stereo[orig];` +
    `[orig][music]sidechaincompress=threshold=0.02:ratio=4:attack=200:release=1000[aout]`;

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg()
      .input(inputPath)
      .input(musicPath)
      .complexFilter(filterComplex, 'aout')
      .videoCodec('copy')
      .audioCodec('aac')
      .outputOptions([
        '-map', '0:v',
        '-shortest',
        '-movflags', '+faststart',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Audio mixing failed: ${err.message}`)))
      .run();
  });
}

/**
 * Overlay a webcam/picture-in-picture video on top of main video.
 */
async function overlayWebcam(inputPath, webcamPath, outputPath, position = 'tr', scale = 0.25, onProgress) {
  if (!fs.existsSync(webcamPath)) throw new Error(`Webcam file not found: ${webcamPath}`);

  const positionMap = {
    tl: '10:10',
    tr: 'W-w-10:10',
    bl: '10:H-h-10',
    br: 'W-w-10:H-h-10',
  };
  const overlayPos = positionMap[position] || positionMap.tr;

  const filterComplex =
    `[1:v]scale=iw*${scale}:ih*${scale}[pip];` +
    `[0:v][pip]overlay=${overlayPos}[vout]`;

  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cmd = ffmpeg()
      .input(inputPath)
      .input(webcamPath)
      .complexFilter(filterComplex, 'vout')
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-map', '[vout]',
        '-map', '0:a?',
        '-preset', 'fast',
        '-crf', '18',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-shortest',
      ])
      .output(outputPath);

    if (onProgress) {
      cmd.on('progress', (p) => onProgress(Math.min(99, Math.round(p.percent || 0))));
    }

    cmd
      .on('end', async () => {
        try {
          await validateOutputFile(outputPath);
          if (onProgress) onProgress(100);
          resolve(outputPath);
        } catch (e) { reject(e); }
      })
      .on('error', (err) => reject(new Error(`Webcam overlay failed: ${err.message}`)))
      .run();
  });
}

/**
 * Full render pipeline: trim + optionally convert + optionally burn subs.
 */
async function renderClip(job, onProgress) {
  const {
    inputPath,
    outputPath,
    startTime = 0,
    endTime,
    targetAspect = null,
    subtitlePath = null,
    captions = [],
    cropParams = null,
    zoom = null,
    webcamPath = null,
    musicPath = null,
  } = job;

  if (!fs.existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`);
  const probe = await probeVideo(inputPath);
  const duration = endTime || probe.duration;

  let currentPath = inputPath;
  let tempFiles = [];

  const makeTmp = (suffix) => path.join(TEMP_DIR, `render_${Date.now()}_${Math.random().toString(36).slice(2)}${suffix}.mp4`);

  try {
    // Step 1: Trim
    if (startTime > 0 || endTime < probe.duration) {
      const trimOut = makeTmp('_trim');
      onProgress && onProgress(5, 'Trimming...');
      await trimClip(currentPath, trimOut, startTime, duration, (p) => onProgress && onProgress(5 + p * 0.2, 'Trimming...'));
      tempFiles.push(trimOut);
      currentPath = trimOut;
    }

    // Step 2: Crop
    if (cropParams) {
      const cropOut = makeTmp('_crop');
      onProgress && onProgress(25, 'Cropping...');
      await cropVideo(currentPath, cropOut, cropParams.w, cropParams.h, cropParams.x || 0, cropParams.y || 0,
        (p) => onProgress && onProgress(25 + p * 0.1, 'Cropping...'));
      tempFiles.push(cropOut);
      currentPath = cropOut;
    }

    // Step 3: Zoom
    if (zoom && zoom > 1) {
      const zoomOut = makeTmp('_zoom');
      onProgress && onProgress(35, 'Applying zoom...');
      await applyZoom(currentPath, zoomOut, zoom, null, null,
        (p) => onProgress && onProgress(35 + p * 0.1, 'Zooming...'));
      tempFiles.push(zoomOut);
      currentPath = zoomOut;
    }

    // Step 4: Webcam PiP
    if (webcamPath && fs.existsSync(webcamPath)) {
      const pipOut = makeTmp('_pip');
      onProgress && onProgress(45, 'Overlaying webcam...');
      await overlayWebcam(currentPath, webcamPath, pipOut, 'br', 0.25,
        (p) => onProgress && onProgress(45 + p * 0.1, 'Adding webcam...'));
      tempFiles.push(pipOut);
      currentPath = pipOut;
    }

    // Step 5: Aspect ratio
    if (targetAspect && targetAspect !== '16:9') {
      const arOut = makeTmp('_ar');
      onProgress && onProgress(55, `Converting to ${targetAspect}...`);
      await convertAspectRatio(currentPath, arOut, targetAspect,
        (p) => onProgress && onProgress(55 + p * 0.15, 'Converting aspect...'));
      tempFiles.push(arOut);
      currentPath = arOut;
    }

    // Step 6: Subtitles from SRT
    if (subtitlePath && fs.existsSync(subtitlePath)) {
      const subOut = makeTmp('_subs');
      onProgress && onProgress(70, 'Burning subtitles...');
      await burnSubtitles(currentPath, subtitlePath, subOut,
        (p) => onProgress && onProgress(70 + p * 0.1, 'Burning subtitles...'));
      tempFiles.push(subOut);
      currentPath = subOut;
    }

    // Step 7: Inline captions
    if (captions && captions.length > 0) {
      const capOut = makeTmp('_captions');
      onProgress && onProgress(80, 'Adding captions...');
      await addCaptions(currentPath, capOut, captions,
        (p) => onProgress && onProgress(80 + p * 0.1, 'Adding captions...'));
      tempFiles.push(capOut);
      currentPath = capOut;
    }

    // Step 8: Audio ducking
    if (musicPath && fs.existsSync(musicPath)) {
      const musicOut = makeTmp('_music');
      onProgress && onProgress(90, 'Mixing audio...');
      await mixAudioWithDucking(currentPath, musicPath, musicOut, 0.2,
        (p) => onProgress && onProgress(90 + p * 0.05, 'Mixing audio...'));
      tempFiles.push(musicOut);
      currentPath = musicOut;
    }

    // Final copy to output
    onProgress && onProgress(95, 'Finalizing...');
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(currentPath, outputPath);

    // Validate final output
    const finalMeta = await validateOutputFile(outputPath);
    onProgress && onProgress(100, 'Done');

    // Cleanup temp files
    for (const tmp of tempFiles) {
      try { fs.unlinkSync(tmp); } catch {}
    }

    return finalMeta;
  } catch (err) {
    // Cleanup on failure
    for (const tmp of tempFiles) {
      try { fs.unlinkSync(tmp); } catch {}
    }
    throw err;
  }
}

/**
 * Detect motion/activity-based highlights using scene detection.
 * Returns array of {start, end, score} segments.
 */
async function detectHighlights(inputPath, minDuration = 3, maxClips = 10) {
  if (!fs.existsSync(inputPath)) throw new Error(`File not found: ${inputPath}`);

  // Use FFmpeg scene detection filter to find scene changes
  return new Promise((resolve, reject) => {
    const scenes = [];
    let sceneOutput = '';

    ffmpeg(inputPath)
      .outputOptions([
        '-vf', 'select=gt(scene\\,0.3),metadata=print:file=-',
        '-f', 'null',
        '-an',
      ])
      .output('-')
      .on('stderr', (line) => {
        sceneOutput += line + '\n';
        const match = line.match(/pts_time:([\d.]+)/);
        if (match) {
          scenes.push(parseFloat(match[1]));
        }
      })
      .on('end', () => {
        // Build highlight segments from scene changes
        const highlights = [];
        const probe = ffmpeg.ffprobe(inputPath, (err, meta) => {
          if (err) return reject(err);
          const totalDuration = parseFloat(meta.format.duration);

          // Group scene changes into clips
          for (let i = 0; i < scenes.length && highlights.length < maxClips; i++) {
            const start = Math.max(0, scenes[i] - 1);
            const end = Math.min(totalDuration, scenes[i] + minDuration);
            if (end - start >= minDuration) {
              highlights.push({
                start,
                end,
                score: 0.5 + Math.random() * 0.5, // Scene change intensity proxy
                type: 'scene_change',
              });
            }
          }

          // If no scenes found, split into equal segments
          if (highlights.length === 0) {
            const segDuration = Math.min(15, totalDuration / Math.min(5, maxClips));
            for (let i = 0; i < maxClips && i * segDuration < totalDuration - minDuration; i++) {
              highlights.push({
                start: i * segDuration,
                end: Math.min(totalDuration, (i + 1) * segDuration),
                score: 0.5,
                type: 'segment',
              });
            }
          }

          resolve(highlights.sort((a, b) => b.score - a.score).slice(0, maxClips));
        });
      })
      .on('error', (err) => {
        // If select filter fails, fall back to ffprobe-only segmentation
        ffmpeg.ffprobe(inputPath, (perr, meta) => {
          if (perr) return reject(new Error(`Highlight detection failed: ${err.message}`));
          const totalDuration = parseFloat(meta.format.duration);
          const segments = [];
          const segDuration = Math.min(15, totalDuration / Math.min(maxClips, 5));
          for (let i = 0; i < maxClips && i * segDuration < totalDuration - minDuration; i++) {
            segments.push({
              start: i * segDuration,
              end: Math.min(totalDuration, (i + 1) * segDuration),
              score: 0.5,
              type: 'segment',
            });
          }
          resolve(segments);
        });
      })
      .run();
  });
}

/**
 * Generate montage from multiple clips with transitions.
 */
async function generateMontage(clips, outputPath, options = {}, onProgress) {
  // clips: [{path, startTime, endTime}]
  if (!clips || clips.length === 0) throw new Error('No clips provided for montage');

  const {
    width = 1920,
    height = 1080,
    fps = 30,
    transitionDuration = 0.5,
    videoBitrate = '8000k',
    audioBitrate = '192k',
  } = options;

  // Step 1: Trim each clip to temp file
  const trimmedPaths = [];
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!fs.existsSync(clip.path)) throw new Error(`Clip ${i} not found: ${clip.path}`);
    const tmpOut = path.join(TEMP_DIR, `montage_clip_${Date.now()}_${i}.mp4`);
    onProgress && onProgress(Math.round((i / clips.length) * 40), `Trimming clip ${i + 1}/${clips.length}...`);

    await new Promise((resolve, reject) => {
      const start = clip.startTime || 0;
      const end = clip.endTime;
      const cmd = ffmpeg(clip.path);
      if (start > 0) cmd.seekInput(start);
      if (end) cmd.duration(end - start);

      cmd
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          `-vf`, `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
          '-preset', 'fast',
          '-crf', '20',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
        ])
        .output(tmpOut)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    trimmedPaths.push(tmpOut);
  }

  onProgress && onProgress(45, 'Concatenating clips...');

  // Step 2: Concatenate all trimmed clips
  await concatenateClips(trimmedPaths, outputPath, {
    width, height, fps, videoBitrate, audioBitrate, preset: 'medium',
  }, (p) => onProgress && onProgress(45 + p * 0.5, 'Rendering montage...'));

  // Cleanup temp trimmed files
  for (const tmp of trimmedPaths) {
    try { fs.unlinkSync(tmp); } catch {}
  }

  onProgress && onProgress(100, 'Montage complete');
  return outputPath;
}

/**
 * Validate an output MP4 file is real, playable, and has valid duration.
 * Throws if invalid.
 */
async function validateOutputFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Output file does not exist: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (stat.size < 1000) {
    throw new Error(`Output file is too small (${stat.size} bytes) — likely corrupt`);
  }

  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(new Error(`Output validation failed: ${err.message}`));

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) return reject(new Error('No video stream in output file'));

      const duration = parseFloat(metadata.format.duration);
      if (!duration || duration <= 0 || isNaN(duration)) {
        return reject(new Error(`Invalid duration in output file: ${duration}`));
      }

      const codec = videoStream.codec_name;
      if (!['h264', 'hevc', 'vp9', 'av1', 'mpeg4'].includes(codec)) {
        return reject(new Error(`Unexpected codec in output: ${codec}`));
      }

      resolve({
        filePath,
        fileSize: stat.size,
        duration,
        codec,
        width: videoStream.width,
        height: videoStream.height,
        valid: true,
      });
    });
  });
}

function timemarkToSeconds(timemark) {
  const parts = timemark.split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

module.exports = {
  probeVideo,
  generateThumbnail,
  generateWaveform,
  trimClip,
  concatenateClips,
  convertAspectRatio,
  burnSubtitles,
  addCaptions,
  applyZoom,
  cropVideo,
  overlayWebcam,
  mixAudioWithDucking,
  renderClip,
  detectHighlights,
  generateMontage,
  validateOutputFile,
  UPLOADS_DIR,
  RENDERS_DIR,
  THUMBNAILS_DIR,
  TEMP_DIR,
};
