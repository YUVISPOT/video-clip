'use strict';

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '../../prisma/dev.db.json');
const PRISMA_DIR = path.join(__dirname, '../../prisma');
if (!fs.existsSync(PRISMA_DIR)) fs.mkdirSync(PRISMA_DIR, { recursive: true });

// Simple JSON-file backed store — persists to disk, no native binaries needed.
// Each table is an array of objects in memory, flushed to JSON on every write.

class Store {
  constructor() {
    this._data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DB_PATH)) {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      }
    } catch {}
    return { users: [], projects: [], clips: [], renders: [], exportJobs: [], timelines: [], timelineItems: [] };
  }

  _save() {
    fs.writeFileSync(DB_PATH, JSON.stringify(this._data, null, 2), 'utf8');
  }

  _table(name) {
    if (!this._data[name]) this._data[name] = [];
    return this._data[name];
  }

  _now() { return new Date().toISOString(); }

  // ── clips ──────────────────────────────────────────────────────────────────
  createClip(data) {
    const row = {
      id: uuidv4(), createdAt: this._now(), updatedAt: this._now(),
      status: 'ready', hasAudio: true, thumbnailPath: null, waveformPath: null, projectId: null,
      ...data,
    };
    this._table('clips').push(row);
    this._save();
    return row;
  }

  findClips(where = {}) {
    let rows = this._table('clips');
    if (where.projectId !== undefined) rows = rows.filter(r => r.projectId === where.projectId);
    if (where.id) rows = rows.filter(r => r.id === where.id);
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  findClip(id) {
    return this._table('clips').find(r => r.id === id) || null;
  }

  updateClip(id, data) {
    const idx = this._table('clips').findIndex(r => r.id === id);
    if (idx === -1) return null;
    this._data.clips[idx] = { ...this._data.clips[idx], ...data, updatedAt: this._now() };
    this._save();
    return this._data.clips[idx];
  }

  deleteClip(id) {
    this._data.clips = this._data.clips.filter(r => r.id !== id);
    this._data.renders = this._data.renders.filter(r => r.clipId !== id);
    this._data.timelineItems = this._data.timelineItems.filter(r => r.clipId !== id);
    this._save();
  }

  // ── renders ────────────────────────────────────────────────────────────────
  createRender(data) {
    const row = {
      id: uuidv4(), createdAt: this._now(), updatedAt: this._now(),
      status: 'pending', progress: 0, errorMessage: null, filePath: null, outputPath: null,
      fileSize: null, duration: null,
      ...data,
    };
    this._table('renders').push(row);
    this._save();
    return row;
  }

  findRenders(where = {}) {
    let rows = this._table('renders');
    if (where.clipId) rows = rows.filter(r => r.clipId === where.clipId);
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  findRender(id) {
    return this._table('renders').find(r => r.id === id) || null;
  }

  updateRender(id, data) {
    const idx = this._table('renders').findIndex(r => r.id === id);
    if (idx === -1) return null;
    this._data.renders[idx] = { ...this._data.renders[idx], ...data, updatedAt: this._now() };
    this._save();
    return this._data.renders[idx];
  }

  deleteRender(id) {
    this._data.renders = this._data.renders.filter(r => r.id !== id);
    this._save();
  }

  // ── exportJobs ─────────────────────────────────────────────────────────────
  createExportJob(data) {
    const row = {
      id: uuidv4(), createdAt: this._now(), updatedAt: this._now(),
      status: 'pending', progress: 0, errorMessage: null, outputPath: null,
      fileSize: null, duration: null, codec: null,
      outputFormat: 'mp4', aspectRatio: '16:9', resolution: '1920x1080',
      fps: 30, videoBitrate: '8000k', audioBitrate: '192k', preset: 'medium',
      ...data,
    };
    this._table('exportJobs').push(row);
    this._save();
    return row;
  }

  findExportJobs(opts = {}) {
    let rows = this._table('exportJobs');
    if (opts.projectId) rows = rows.filter(r => r.projectId === opts.projectId);
    return rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, opts.take || 100);
  }

  findExportJob(id) {
    return this._table('exportJobs').find(r => r.id === id) || null;
  }

  updateExportJob(id, data) {
    const idx = this._table('exportJobs').findIndex(r => r.id === id);
    if (idx === -1) return null;
    this._data.exportJobs[idx] = { ...this._data.exportJobs[idx], ...data, updatedAt: this._now() };
    this._save();
    return this._data.exportJobs[idx];
  }

  deleteExportJob(id) {
    this._data.exportJobs = this._data.exportJobs.filter(r => r.id !== id);
    this._save();
  }

  // ── projects ───────────────────────────────────────────────────────────────
  createProject(data) {
    const row = {
      id: uuidv4(), createdAt: this._now(), updatedAt: this._now(),
      description: null, userId: null,
      ...data,
    };
    this._table('projects').push(row);
    this._save();
    return row;
  }

  findProjects() {
    return this._table('projects').sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  findProject(id) {
    const proj = this._table('projects').find(r => r.id === id);
    if (!proj) return null;
    return {
      ...proj,
      clips: this._table('clips').filter(c => c.projectId === id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      timelines: this._table('timelines').filter(t => t.projectId === id).map(t => ({
        ...t,
        items: this._table('timelineItems')
          .filter(i => i.timelineId === t.id)
          .sort((a, b) => a.position - b.position)
          .map(item => ({ ...item, clip: this.findClip(item.clipId) })),
      })),
      exportJobs: this.findExportJobs({ projectId: id, take: 10 }),
      _count: {
        clips: this._table('clips').filter(c => c.projectId === id).length,
        exportJobs: this._table('exportJobs').filter(j => j.projectId === id).length,
      },
    };
  }

  updateProject(id, data) {
    const idx = this._table('projects').findIndex(r => r.id === id);
    if (idx === -1) return null;
    this._data.projects[idx] = { ...this._data.projects[idx], ...data, updatedAt: this._now() };
    this._save();
    return this._data.projects[idx];
  }

  deleteProject(id) {
    this._data.projects = this._data.projects.filter(r => r.id !== id);
    this._save();
  }

  // ── timelines ──────────────────────────────────────────────────────────────
  createTimeline(data) {
    const row = {
      id: uuidv4(), createdAt: this._now(), updatedAt: this._now(),
      name: 'Main Timeline',
      ...data,
    };
    this._table('timelines').push(row);
    this._save();
    return row;
  }

  findTimeline(id) {
    const t = this._table('timelines').find(r => r.id === id);
    if (!t) return null;
    return {
      ...t,
      items: this._table('timelineItems')
        .filter(i => i.timelineId === id)
        .sort((a, b) => a.position - b.position)
        .map(item => ({ ...item, clip: this.findClip(item.clipId) })),
    };
  }

  createTimelineItem(data) {
    const row = {
      id: uuidv4(), createdAt: this._now(), updatedAt: this._now(),
      trackIndex: 0, volume: 1.0, playbackRate: 1.0, zoomFactor: 1.0,
      cropX: null, cropY: null, cropW: null, cropH: null,
      ...data,
    };
    this._table('timelineItems').push(row);
    this._save();
    return { ...row, clip: this.findClip(row.clipId) };
  }

  updateTimelineItem(id, data) {
    const idx = this._table('timelineItems').findIndex(r => r.id === id);
    if (idx === -1) return null;
    this._data.timelineItems[idx] = { ...this._data.timelineItems[idx], ...data, updatedAt: this._now() };
    this._save();
    return { ...this._data.timelineItems[idx], clip: this.findClip(this._data.timelineItems[idx].clipId) };
  }

  deleteTimelineItem(id) {
    this._data.timelineItems = this._data.timelineItems.filter(r => r.id !== id);
    this._save();
  }

  countClips(where = {}) {
    let rows = this._table('clips');
    if (where.projectId !== undefined) rows = rows.filter(r => r.projectId === where.projectId);
    return rows.length;
  }
}

const db = new Store();
module.exports = { db };
