'use strict';

require('express-async-errors');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');

const uploadRoute   = require('./routes/upload');
const clipsRoute    = require('./routes/clips');
const exportRoute   = require('./routes/export');
const projectsRoute = require('./routes/projects');
const rendersRoute  = require('./routes/renders');
const musicRoute    = require('./routes/music');
const { queue }     = require('./processors/job-queue');
const { RENDERS_DIR, THUMBNAILS_DIR, UPLOADS_DIR, TEMP_DIR } = require('./processors/ffmpeg-pipeline');

const PORT = process.env.PORT || 4000;
const app = express();
const server = http.createServer(app);

// ── WebSocket live progress ─────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });
const wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  try { ws.send(JSON.stringify({ type: 'queue_state', jobs: queue.list() })); } catch {}
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) { try { ws.send(data); } catch {} }
}

queue.on('job:queued',    (id)         => broadcast({ type: 'job:queued',   jobId: id, job: queue.get(id) }));
queue.on('job:started',   (id)         => broadcast({ type: 'job:started',  jobId: id, job: queue.get(id) }));
queue.on('job:progress',  (id, p, msg) => broadcast({ type: 'job:progress', jobId: id, progress: p, message: msg }));
queue.on('job:done',      (id, result) => broadcast({ type: 'job:done',     jobId: id, result }));
queue.on('job:error',     (id, err)    => broadcast({ type: 'job:error',    jobId: id, error: err }));
queue.on('job:cancelled', (id)         => broadcast({ type: 'job:cancelled',jobId: id }));

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static serving ──────────────────────────────────────────────────────────
app.use('/renders',    express.static(RENDERS_DIR));
app.use('/thumbnails', express.static(THUMBNAILS_DIR));
app.use('/music', express.static(require('path').join(__dirname, '../music')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/upload',   uploadRoute);
app.use('/api/clips',    clipsRoute);
app.use('/api/export',   exportRoute);
app.use('/api/projects', projectsRoute);
app.use('/api/renders',  rendersRoute);
app.use('/api/music',    musicRoute);

app.get('/api/health', (req, res) => res.json({
  status: 'ok', uptime: process.uptime(),
  queue: { running: queue.running, pending: queue.queue.length, total: queue.jobs.size },
}));

// Temp cleanup every 30 min
setInterval(() => {
  const now = Date.now();
  [TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      try { if (now - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp); } catch {}
    });
  });
}, 30 * 60 * 1000);


// Video streaming with range support
app.get('/api/upload-stream/:filename', (req, res) => {
  const { UPLOADS_DIR } = require('./processors/ffmpeg-pipeline');
  const fp = require('path').join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const stat = fs.statSync(fp);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
      'Accept-Ranges': 'bytes', 'Content-Length': chunkSize, 'Content-Type': 'video/mp4',
    });
    fs.createReadStream(fp, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': 'video/mp4' });
    fs.createReadStream(fp).pipe(res);
  }
});
// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (max 4GB)' });
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`\n✅ VideoClip API  →  http://localhost:${PORT}`);
  console.log(`   WebSocket      →  ws://localhost:${PORT}/ws`);
  console.log(`   Renders        →  ${RENDERS_DIR}\n`);
});

module.exports = { app, server };
// This appends nothing - video streaming is handled via a route below
