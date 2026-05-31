'use strict';

const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');

class JobQueue extends EventEmitter {
  constructor(concurrency = 2) {
    super();
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
    this.jobs = new Map(); // jobId -> {status, progress, result, error, createdAt}
  }

  add(fn, jobId = uuidv4()) {
    this.jobs.set(jobId, {
      id: jobId,
      status: 'pending',
      progress: 0,
      message: 'Queued',
      result: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    });

    this.queue.push({ fn, jobId });
    this.emit('job:queued', jobId);
    this._drain();
    return jobId;
  }

  _drain() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const { fn, jobId } = this.queue.shift();
      this._run(fn, jobId);
    }
  }

  async _run(fn, jobId) {
    this.running++;
    const job = this.jobs.get(jobId);
    job.status = 'running';
    job.startedAt = new Date();
    this.emit('job:started', jobId);

    const onProgress = (percent, message) => {
      job.progress = Math.min(100, Math.round(percent));
      job.message = message || job.message;
      this.emit('job:progress', jobId, job.progress, job.message);
    };

    try {
      const result = await fn(onProgress);
      job.status = 'done';
      job.progress = 100;
      job.result = result;
      job.finishedAt = new Date();
      this.emit('job:done', jobId, result);
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      job.finishedAt = new Date();
      this.emit('job:error', jobId, err.message);
    } finally {
      this.running--;
      this._drain();
    }
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  list() {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(jobId) {
    // Remove from pending queue if not yet started
    const idx = this.queue.findIndex(q => q.jobId === jobId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      const job = this.jobs.get(jobId);
      if (job) {
        job.status = 'cancelled';
        job.finishedAt = new Date();
        this.emit('job:cancelled', jobId);
      }
      return true;
    }
    return false;
  }
}

const queue = new JobQueue(2);
module.exports = { queue, JobQueue };
