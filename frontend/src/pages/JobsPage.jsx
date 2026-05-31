import React, { useState, useEffect } from 'react';
import { Activity, Download, XCircle, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useJobs } from '../App';

function fmtAge(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function JobsPage() {
  const { jobs: liveJobs, connected } = useJobs();
  const [dbJobs, setDbJobs] = useState([]);
  const [renders, setRenders] = useState([]);

  const load = () => {
    api.getExportJobs().then(d => setDbJobs(d.jobs)).catch(() => {});
    api.getRenders().then(d => setRenders(d.renders)).catch(() => {});
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const deleteJob = async (id) => {
    await api.deleteExportJob(id);
    setDbJobs(p => p.filter(j => j.id !== id));
  };

  const deleteRender = async (id) => {
    await api.deleteRender(id);
    setRenders(p => p.filter(r => r.id !== id));
  };

  // Merge DB jobs with live WS progress
  const merged = dbJobs.map(j => {
    const live = liveJobs[j.id];
    return live ? { ...j, status: live.status, progress: live.progress, _liveMessage: live.message } : j;
  });

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Render Queue</h1>
          <p>Live job progress via WebSocket</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: connected ? 'var(--success)' : 'var(--error)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? 'var(--success)' : 'var(--error)', display: 'inline-block' }} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
        <button onClick={load}><RefreshCw size={15} /></button>
      </div>

      {/* Live queue state */}
      {Object.keys(liveJobs).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">Live Queue ({Object.values(liveJobs).filter(j => j.status === 'running').length} running)</div>
          {Object.values(liveJobs).filter(j => ['pending', 'running'].includes(j.status)).map(j => (
            <div key={j.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className={`badge badge-${j.status}`}>{j.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{j.id.slice(0, 8)}...</span>
                {j.message && <span style={{ fontSize: 11, color: 'var(--text2)' }}>{j.message}</span>}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${j.progress || 0}%` }} />
              </div>
            </div>
          ))}
          {Object.values(liveJobs).filter(j => ['pending', 'running'].includes(j.status)).length === 0 && (
            <div className="text-muted text-sm">No active jobs</div>
          )}
        </div>
      )}

      {/* Export jobs */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Export Jobs</div>
        {merged.length === 0 ? (
          <div className="text-muted text-sm">No export jobs yet</div>
        ) : merged.map(j => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className={`badge badge-${j.status}`}>{j.status}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{j.type}</span>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{j.aspectRatio} · {j.resolution}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>{fmtAge(j.createdAt)}</span>
              </div>
              {['pending', 'running'].includes(j.status) && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${j.progress || 0}%` }} />
                </div>
              )}
              {j._liveMessage && <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{j._liveMessage}</div>}
              {j.status === 'error' && j.errorMessage && <div className="text-error text-sm">{j.errorMessage}</div>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {j.status === 'done' && j.outputPath && (
                <a href={j.outputPath} download className="btn btn-sm btn-primary"><Download size={12} /></a>
              )}
              <button className="btn btn-sm btn-danger" onClick={() => deleteJob(j.id)}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Render jobs */}
      <div className="card">
        <div className="section-title">Trim Renders</div>
        {renders.length === 0 ? (
          <div className="text-muted text-sm">No renders yet</div>
        ) : renders.map(r => {
          const live = liveJobs[r.id];
          const status = live?.status || r.status;
          const progress = live?.progress ?? r.progress;
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span className={`badge badge-${status}`}>{status}</span>
                  <span style={{ fontSize: 12 }}>{r.clip?.originalName || 'Unknown clip'}</span>
                  {r.duration && <span style={{ fontSize: 11, color: 'var(--text2)' }}>{r.duration.toFixed(1)}s</span>}
                  <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>{fmtAge(r.createdAt)}</span>
                </div>
                {['pending', 'running'].includes(status) && (
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress || 0}%` }} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {status === 'done' && r.outputPath && (
                  <a href={r.outputPath} download className="btn btn-sm btn-primary"><Download size={12} /></a>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => deleteRender(r.id)}><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
