import React, { useState, useEffect } from 'react';
import { Zap, Film, Check, Download, X, Info } from 'lucide-react';
import { api } from '../api/client';
import { useJobs } from '../App';

function fmtDur(s) {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function AutoMontagePage() {
  const [clips, setClips] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [targetDuration, setTargetDuration] = useState(60);
  const [targetAspect, setTargetAspect] = useState('16:9');
  const [minHL, setMinHL] = useState(3);
  const [maxHL, setMaxHL] = useState(15);
  const [resolution, setResolution] = useState('1920x1080');
  const [fps, setFps] = useState(30);
  const [activeJobId, setActiveJobId] = useState(null);
  const [history, setHistory] = useState([]);
  const { jobs: liveJobs } = useJobs();

  useEffect(() => {
    api.getClips().then(d => setClips(d.clips)).catch(() => {});
    api.getExportJobs().then(d =>
      setHistory(d.jobs.filter(j => j.type === 'auto-montage'))
    ).catch(() => {});
  }, []);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectAll = () => setSelected(new Set(clips.map(c => c.id)));
  const clearAll = () => setSelected(new Set());

  const run = async () => {
    if (!selected.size) { alert('Select at least one clip'); return; }
    const [w, h] = resolution.split('x').map(Number);
    try {
      const { exportJob } = await api.autoMontage({
        clipIds: [...selected],
        targetDuration: parseInt(targetDuration),
        targetAspect,
        minHighlightDuration: parseFloat(minHL),
        maxHighlightDuration: parseFloat(maxHL),
        width: w, height: h, fps: parseInt(fps),
        videoBitrate: '8000k', audioBitrate: '192k',
      });
      setActiveJobId(exportJob.id);
      setHistory(p => [exportJob, ...p]);
    } catch (e) {
      alert('Failed to start: ' + e.message);
    }
  };

  const liveJob = activeJobId ? liveJobs[activeJobId] : null;
  const totalSourceDur = clips
    .filter(c => selected.has(c.id))
    .reduce((a, c) => a + (c.duration || 0), 0);

  return (
    <div>
      <div className="page-header">
        <h1>Auto Montage</h1>
        <p>Select footage → AI picks the best moments → renders a complete highlight reel automatically</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>

        {/* Clip selector */}
        <div>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div className="section-title" style={{ margin: 0, flex: 1 }}>
                Source Footage — {selected.size}/{clips.length} selected
              </div>
              <button className="btn btn-sm" onClick={selectAll}>All</button>
              <button className="btn btn-sm" onClick={clearAll}>None</button>
            </div>

            {clips.length === 0 ? (
              <div className="empty" style={{ padding: 30 }}>
                <Film size={36} />
                <p style={{ marginTop: 8 }}>No clips yet — upload videos first</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {clips.map(c => (
                  <div
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    style={{
                      borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
                      border: `2px solid ${selected.has(c.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: selected.has(c.id) ? 'var(--accent-dim)' : 'var(--bg3)',
                      transition: 'all 0.15s',
                      position: 'relative',
                    }}
                  >
                    {selected.has(c.id) && (
                      <div style={{
                        position: 'absolute', top: 6, right: 6, zIndex: 2,
                        background: 'var(--accent)', borderRadius: '50%',
                        width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Check size={12} color="white" />
                      </div>
                    )}
                    {c.thumbnailPath
                      ? <img src={c.thumbnailPath} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} alt="" />
                      : <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Film size={24} color="var(--text3)" />
                        </div>
                    }
                    <div style={{ padding: '6px 8px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.originalName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>{fmtDur(c.duration)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live job progress */}
          {liveJob && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="section-title">Rendering Auto Montage</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span className={`badge badge-${liveJob.status}`}>{liveJob.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{liveJob.message}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{liveJob.progress || 0}%</span>
              </div>
              <div className="progress-bar" style={{ height: 10 }}>
                <div className="progress-fill" style={{ width: `${liveJob.progress || 0}%` }} />
              </div>

              {liveJob.status === 'done' && liveJob.result && (
                <div style={{ marginTop: 14, padding: 12, background: 'var(--bg3)', borderRadius: 6 }}>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                    <span>✅ Done</span>
                    <span>Duration: <strong>{fmtDur(liveJob.result.duration)}</strong></span>
                    <span>Highlights: <strong>{liveJob.result.highlightsUsed}</strong></span>
                  </div>
                  <a
                    href={liveJob.result.outputPath}
                    download
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    <Download size={15} /> Download Montage MP4
                  </a>
                </div>
              )}

              {liveJob.status === 'error' && (
                <div className="text-error text-sm" style={{ marginTop: 8 }}>
                  ❌ {liveJob.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Settings panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="section-title">Montage Settings</div>

            <div className="form-group">
              <label>Target Length</label>
              <select value={targetDuration} onChange={e => setTargetDuration(e.target.value)}>
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="90">90 seconds</option>
                <option value="120">2 minutes</option>
                <option value="180">3 minutes</option>
                <option value="300">5 minutes</option>
              </select>
            </div>

            <div className="form-group">
              <label>Output Format</label>
              <select value={targetAspect} onChange={e => setTargetAspect(e.target.value)}>
                <option value="16:9">16:9 — YouTube / Landscape</option>
                <option value="9:16">9:16 — TikTok / Reels / Shorts</option>
                <option value="1:1">1:1 — Instagram Square</option>
              </select>
            </div>

            <div className="form-group">
              <label>Resolution</label>
              <select value={resolution} onChange={e => setResolution(e.target.value)}>
                <option value="1920x1080">1920×1080 (1080p)</option>
                <option value="1280x720">1280×720 (720p)</option>
                <option value="3840x2160">3840×2160 (4K)</option>
                {targetAspect === '9:16' && <option value="1080x1920">1080×1920 (Vertical)</option>}
              </select>
            </div>

            <div className="form-group">
              <label>FPS</label>
              <select value={fps} onChange={e => setFps(e.target.value)}>
                <option value="24">24 fps</option>
                <option value="30">30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div className="form-group">
                <label>Min clip (s)</label>
                <input type="number" value={minHL} min="1" max="10" step="0.5"
                  onChange={e => setMinHL(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Max clip (s)</label>
                <input type="number" value={maxHL} min="5" max="60" step="1"
                  onChange={e => setMaxHL(e.target.value)} />
              </div>
            </div>

            {/* Summary */}
            {selected.size > 0 && (
              <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text2)' }}>Source footage:</span>
                  <strong>{fmtDur(totalSourceDur)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text2)' }}>Target output:</span>
                  <strong>{fmtDur(parseInt(targetDuration))}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text2)' }}>Clips selected:</span>
                  <strong>{selected.size}</strong>
                </div>
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '11px', fontSize: 14 }}
              onClick={run}
              disabled={!selected.size || (liveJob && ['pending','running'].includes(liveJob.status))}
            >
              <Zap size={16} />
              {liveJob && ['pending','running'].includes(liveJob.status)
                ? 'Rendering...'
                : 'Generate Auto Montage'}
            </button>

            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>FFmpeg analyzes scene changes and motion in your footage to find the best moments, then renders a real MP4 — no manual editing needed.</span>
            </div>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="card">
              <div className="section-title">Past Auto Montages</div>
              {history.slice(0, 5).map(j => {
                const live = liveJobs[j.id];
                const status = live?.status || j.status;
                const progress = live?.progress ?? j.progress;
                return (
                  <div key={j.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span className={`badge badge-${status}`}>{status}</span>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {j.aspectRatio} · {j.resolution}
                      </span>
                    </div>
                    {['pending','running'].includes(status) && (
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                    {status === 'done' && j.outputPath && (
                      <a href={j.outputPath} download className="btn btn-sm btn-primary" style={{ marginTop: 4 }}>
                        <Download size={12} /> Download
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
