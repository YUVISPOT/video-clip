import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Scissors, Trash2, Download, Zap, RefreshCw } from 'lucide-react';
import { api } from '../api/client';

function fmt(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return (bytes / 1e3).toFixed(0) + ' KB';
}

function fmtDur(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function ClipsPage() {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [highlights, setHighlights] = useState(null);
  const [loadingHL, setLoadingHL] = useState(false);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    api.getClips().then(d => { setClips(d.clips); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  useEffect(load, []);

  const deleteClip = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Delete this clip?')) return;
    await api.deleteClip(id);
    setClips(p => p.filter(c => c.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const detectHighlights = async () => {
    if (!selected) return;
    setLoadingHL(true);
    try {
      const data = await api.getHighlights(selected.id, { minDuration: 5, maxClips: 8 });
      setHighlights(data.highlights);
    } catch (e) { alert(e.message); }
    finally { setLoadingHL(false); }
  };

  if (loading) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (error) return <div className="empty text-error">{error}</div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Clip Library</h1>
          <p>{clips.length} clip{clips.length !== 1 ? 's' : ''} uploaded</p>
        </div>
        <button onClick={load}><RefreshCw size={15} /> Refresh</button>
      </div>

      {clips.length === 0 ? (
        <div className="empty">
          <Film size={48} />
          <p>No clips yet — upload some videos to get started</p>
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/')}>Upload Videos</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 340px' : '1fr', gap: 20 }}>
          <div className="clip-grid">
            {clips.map(clip => (
              <div
                key={clip.id}
                className={`clip-card ${selected?.id === clip.id ? 'selected' : ''}`}
                onClick={() => setSelected(selected?.id === clip.id ? null : clip)}
              >
                {clip.thumbnailPath
                  ? <img className="clip-thumb" src={clip.thumbnailPath} alt={clip.originalName} />
                  : <div className="clip-thumb-placeholder"><Film size={32} /></div>
                }
                <div className="clip-info">
                  <div className="clip-name">{clip.originalName}</div>
                  <div className="clip-meta">
                    <span>{fmtDur(clip.duration)}</span>
                    <span>{clip.width}×{clip.height}</span>
                    <span>{clip.fps?.toFixed(0)}fps</span>
                    <span>{fmt(clip.fileSize)}</span>
                  </div>
                </div>
                <div className="clip-actions">
                  <button className="btn btn-sm btn-primary" onClick={e => { e.stopPropagation(); navigate(`/editor/${clip.id}`); }}>
                    <Scissors size={13} /> Edit
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={e => deleteClip(clip.id, e)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <div className="section-title">Selected Clip</div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{selected.originalName}</div>
                {selected.thumbnailPath && (
                  <img src={selected.thumbnailPath} style={{ width: '100%', borderRadius: 4, marginBottom: 12 }} alt="" />
                )}
                {selected.waveformPath && (
                  <img src={selected.waveformPath} style={{ width: '100%', borderRadius: 4, marginBottom: 12 }} alt="waveform" />
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, color: 'var(--text2)' }}>
                  <div>Duration: <strong>{fmtDur(selected.duration)}</strong></div>
                  <div>Size: <strong>{fmt(selected.fileSize)}</strong></div>
                  <div>Resolution: <strong>{selected.width}×{selected.height}</strong></div>
                  <div>FPS: <strong>{selected.fps?.toFixed(2)}</strong></div>
                  <div>Codec: <strong>{selected.codec}</strong></div>
                  <div>Audio: <strong>{selected.hasAudio ? 'Yes' : 'No'}</strong></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-primary" onClick={() => navigate(`/editor/${selected.id}`)} style={{ flex: 1 }}>
                    <Scissors size={14} /> Open Editor
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="section-title">Highlight Detection</div>
                <p className="text-muted text-sm" style={{ marginBottom: 10 }}>
                  Detect scene changes and activity spikes automatically using FFmpeg analysis.
                </p>
                <button className="btn btn-primary" onClick={detectHighlights} disabled={loadingHL} style={{ width: '100%' }}>
                  {loadingHL ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Analyzing...</> : <><Zap size={14} /> Detect Highlights</>}
                </button>
                {highlights && highlights.map((h, i) => (
                  <div key={i} style={{ marginTop: 10, padding: '8px', background: 'var(--bg3)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Highlight {i + 1}</span>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>Score: {h.score.toFixed(2)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
                      {fmtDur(h.start)} → {fmtDur(h.end)} ({(h.end - h.start).toFixed(1)}s)
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={() => navigate(`/editor/${selected.id}?start=${h.start.toFixed(2)}&end=${h.end.toFixed(2)}`)}>
                      Edit This Clip
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
