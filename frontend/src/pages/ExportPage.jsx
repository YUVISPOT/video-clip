import React, { useState, useEffect } from 'react';
import { Film, Plus, Trash2, Package, Download, GripVertical } from 'lucide-react';
import { api } from '../api/client';
import { useJobs } from '../App';

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export default function ExportPage() {
  const [clips, setClips] = useState([]);
  const [montageClips, setMontageClips] = useState([]);
  const [resolution, setResolution] = useState('1920x1080');
  const [fps, setFps] = useState(30);
  const [videoBitrate, setVideoBitrate] = useState('8000k');
  const [jobs, setJobs] = useState([]);
  const [activeJobId, setActiveJobId] = useState(null);
  const { jobs: liveJobs } = useJobs();

  useEffect(() => {
    api.getClips().then(d => setClips(d.clips)).catch(() => {});
    api.getExportJobs().then(d => setJobs(d.jobs)).catch(() => {});
  }, []);

  const addToMontage = (clip) => {
    setMontageClips(p => [...p, {
      clipId: clip.id, name: clip.originalName,
      thumb: clip.thumbnailPath, duration: clip.duration,
      startTime: 0, endTime: Math.min(clip.duration, 30),
    }]);
  };

  const removeFromMontage = (idx) => setMontageClips(p => p.filter((_, i) => i !== idx));

  const buildMontage = async () => {
    if (montageClips.length < 1) { alert('Add at least 1 clip to the montage'); return; }
    try {
      const [w, h] = resolution.split('x').map(Number);
      const { exportJob } = await api.exportMontage({
        clips: montageClips.map(c => ({ clipId: c.clipId, startTime: c.startTime, endTime: c.endTime })),
        width: w, height: h, fps: parseInt(fps), videoBitrate,
      });
      setActiveJobId(exportJob.id);
      setJobs(p => [exportJob, ...p]);
    } catch (e) { alert(e.message); }
  };

  const liveJob = activeJobId ? liveJobs[activeJobId] : null;

  return (
    <div>
      <div className="page-header">
        <h1>Export & Montage</h1>
        <p>Build montages from multiple clips or batch export</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Montage Builder */}
        <div>
          <div className="card">
            <div className="section-title">Montage Builder</div>
            <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
              Drag clips into your montage. Each clip is trimmed and concatenated with FFmpeg.
            </p>

            {montageClips.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', background: 'var(--bg3)', borderRadius: 6, color: 'var(--text3)' }}>
                Add clips from the library on the right →
              </div>
            ) : (
              montageClips.map((mc, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px', background: 'var(--bg3)', borderRadius: 6, marginBottom: 6 }}>
                  <GripVertical size={14} color="var(--text3)" />
                  {mc.thumb && <img src={mc.thumb} style={{ width: 60, height: 34, objectFit: 'cover', borderRadius: 3 }} alt="" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mc.name}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      <input type="number" value={mc.startTime} step="0.1" min="0" style={{ width: 60, fontSize: 11, padding: '2px 6px' }}
                        onChange={e => setMontageClips(p => p.map((c, j) => j === i ? { ...c, startTime: parseFloat(e.target.value) } : c))} />
                      <span style={{ fontSize: 11, color: 'var(--text2)', lineHeight: '24px' }}>→</span>
                      <input type="number" value={mc.endTime} step="0.1" max={mc.duration} style={{ width: 60, fontSize: 11, padding: '2px 6px' }}
                        onChange={e => setMontageClips(p => p.map((c, j) => j === i ? { ...c, endTime: parseFloat(e.target.value) } : c))} />
                    </div>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={() => removeFromMontage(i)}><Trash2 size={12} /></button>
                </div>
              ))
            )}

            <hr className="divider" />
            <div className="form-row">
              <div className="form-group">
                <label>Resolution</label>
                <select value={resolution} onChange={e => setResolution(e.target.value)}>
                  <option value="1920x1080">1920×1080 (1080p)</option>
                  <option value="1280x720">1280×720 (720p)</option>
                  <option value="3840x2160">3840×2160 (4K)</option>
                  <option value="1080x1920">1080×1920 (Vertical)</option>
                </select>
              </div>
              <div className="form-group">
                <label>FPS</label>
                <select value={fps} onChange={e => setFps(e.target.value)}>
                  <option value="24">24</option>
                  <option value="30">30</option>
                  <option value="60">60</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Video Bitrate</label>
              <select value={videoBitrate} onChange={e => setVideoBitrate(e.target.value)}>
                <option value="4000k">4 Mbps (streaming)</option>
                <option value="8000k">8 Mbps (standard)</option>
                <option value="16000k">16 Mbps (high quality)</option>
                <option value="25000k">25 Mbps (master)</option>
              </select>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={buildMontage}
              disabled={montageClips.length === 0}>
              <Package size={14} /> Build Montage ({montageClips.length} clips)
            </button>

            {liveJob && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`badge badge-${liveJob.status}`}>{liveJob.status}</span>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{liveJob.message}</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${liveJob.progress || 0}%` }} />
                </div>
                {liveJob.status === 'done' && liveJob.result?.outputPath && (
                  <a href={liveJob.result.outputPath} download className="btn btn-primary" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>
                    <Download size={14} /> Download Montage
                  </a>
                )}
                {liveJob.status === 'error' && (
                  <div className="text-error text-sm" style={{ marginTop: 6 }}>{liveJob.error}</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Clip Library */}
        <div>
          <div className="card">
            <div className="section-title">Clip Library — click to add to montage</div>
            <div style={{ maxHeight: 500, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {clips.length === 0 && <div className="text-muted text-sm">No clips uploaded yet.</div>}
              {clips.map(c => (
                <div key={c.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, background: 'var(--bg3)', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)' }}
                  onClick={() => addToMontage(c)}>
                  {c.thumbnailPath
                    ? <img src={c.thumbnailPath} style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 3 }} alt="" />
                    : <div style={{ width: 64, height: 36, background: 'var(--bg2)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Film size={16} color="var(--text3)" /></div>
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.originalName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>{fmtDur(c.duration)} · {c.width}×{c.height}</div>
                  </div>
                  <Plus size={16} color="var(--accent)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Export Jobs History */}
      {jobs.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="section-title">Export History</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}>Type</th>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}>Progress</th>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}>Output</th>
                <th style={{ textAlign: 'left', padding: '8px 0', fontWeight: 600 }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => {
                const live = liveJobs[j.id];
                const status = live?.status || j.status;
                const progress = live?.progress ?? j.progress;
                return (
                  <tr key={j.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 0' }}>{j.type}</td>
                    <td style={{ padding: '8px 0' }}><span className={`badge badge-${status}`}>{status}</span></td>
                    <td style={{ padding: '8px 0', width: 120 }}>
                      <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                    </td>
                    <td style={{ padding: '8px 0' }}>
                      {j.outputPath && status === 'done' && (
                        <a href={j.outputPath} download className="btn btn-sm btn-primary"><Download size={12} /> MP4</a>
                      )}
                    </td>
                    <td style={{ padding: '8px 0', color: 'var(--text2)', fontSize: 11 }}>
                      {new Date(j.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
