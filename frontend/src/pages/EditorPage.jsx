import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Play, Pause, Scissors, Download, Plus, Trash2, ChevronLeft } from 'lucide-react';
import { api } from '../api/client';
import { useJobs } from '../App';

function fmtDur(s) {
  if (!s) return '0:00';
  const m = Math.floor(s / 60), sec = (s % 60).toFixed(1);
  return `${m}:${String(Math.floor(s % 60)).padStart(2,'0')}.${sec.split('.')[1]}`;
}

export default function EditorPage() {
  const { clipId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { jobs } = useJobs();

  const [clips, setClips] = useState([]);
  const [clip, setClip] = useState(null);
  const [loading, setLoading] = useState(!!clipId);
  const videoRef = useRef();

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [captions, setCaptions] = useState([]);
  const [newCaption, setNewCaption] = useState({ text: '', startTime: 0, endTime: 5, fontSize: 28, color: 'white' });
  const [targetAspect, setTargetAspect] = useState('16:9');
  const [zoom, setZoom] = useState(1);

  const [activeJob, setActiveJob] = useState(null);
  const [renders, setRenders] = useState([]);

  // Load clip list for picker
  useEffect(() => {
    api.getClips().then(d => setClips(d.clips)).catch(() => {});
  }, []);

  // Load specific clip
  useEffect(() => {
    if (!clipId) { setLoading(false); return; }
    setLoading(true);
    api.getClip(clipId).then(({ clip }) => {
      setClip(clip);
      const st = parseFloat(params.get('start')) || 0;
      const et = parseFloat(params.get('end')) || clip.duration;
      setStartTime(st);
      setEndTime(et);
      setDuration(clip.duration);
      setLoading(false);
    }).catch(e => { alert(e.message); setLoading(false); });
  }, [clipId]);

  // Load renders
  useEffect(() => {
    if (!clipId) return;
    api.getClipRenders(clipId).then(d => setRenders(d.renders)).catch(() => {});
  }, [clipId, activeJob]);

  // Video player sync
  const onTimeUpdate = () => setCurrentTime(videoRef.current?.currentTime || 0);
  const onLoaded = () => setDuration(videoRef.current?.duration || 0);
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) { videoRef.current.pause(); setPlaying(false); }
    else { videoRef.current.play(); setPlaying(true); }
  };
  const seek = (e) => {
    const pct = parseFloat(e.target.value);
    const t = (pct / 100) * (duration || 1);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const setInPoint = () => setStartTime(parseFloat(currentTime.toFixed(3)));
  const setOutPoint = () => setEndTime(parseFloat(currentTime.toFixed(3)));

  const doTrim = async () => {
    if (!clip) return;
    if (endTime <= startTime) { alert('Out point must be after in point'); return; }
    try {
      const { render } = await api.trimClip(clip.id, startTime, endTime);
      setActiveJob(render.id);
    } catch (e) { alert(e.message); }
  };

  const doExport = async () => {
    if (!clip) return;
    try {
      const { exportJob } = await api.exportClip({
        clipId: clip.id, startTime, endTime,
        targetAspect, captions,
        zoom: zoom > 1 ? zoom : null,
      });
      setActiveJob(exportJob.id);
    } catch (e) { alert(e.message); }
  };

  const doShort = async () => {
    if (!clip) return;
    try {
      const { exportJob } = await api.exportShort({ clipId: clip.id, startTime, endTime, targetAspect: '9:16' });
      setActiveJob(exportJob.id);
    } catch (e) { alert(e.message); }
  };

  const addCaption = () => {
    setCaptions(p => [...p, { ...newCaption, id: Date.now() }]);
    setNewCaption({ text: '', startTime: currentTime, endTime: currentTime + 5, fontSize: 28, color: 'white' });
  };

  const liveJob = activeJob ? (jobs[activeJob] || null) : null;

  if (loading) return <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>;

  if (!clipId || !clip) {
    return (
      <div>
        <div className="page-header"><h1>Editor</h1><p>Select a clip to start editing</p></div>
        <div className="clip-grid">
          {clips.map(c => (
            <div key={c.id} className="clip-card" onClick={() => navigate(`/editor/${c.id}`)}>
              {c.thumbnailPath
                ? <img className="clip-thumb" src={c.thumbnailPath} alt={c.originalName} />
                : <div className="clip-thumb-placeholder"><span style={{color:'var(--text3)'}}>No preview</span></div>
              }
              <div className="clip-info">
                <div className="clip-name">{c.originalName}</div>
                <div className="clip-meta"><span>{c.duration?.toFixed(1)}s</span><span>{c.width}×{c.height}</span></div>
              </div>
            </div>
          ))}
        </div>
        {clips.length === 0 && (
          <div className="empty">
            <p>No clips available. <a href="/" style={{ color: 'var(--accent)' }}>Upload a video first.</a></p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/clips')} style={{ padding: '6px 10px' }}><ChevronLeft size={16} /></button>
        <div>
          <h1>{clip.originalName}</h1>
          <p>{clip.duration?.toFixed(2)}s · {clip.width}×{clip.height} · {clip.fps?.toFixed(0)}fps · {clip.codec}</p>
        </div>
      </div>

      <div className="editor-layout">
        <div className="editor-left">
          {/* Video Player */}
          <div className="card">
            <div className="video-player-wrap">
              <video
                ref={videoRef}
                src={`/api/upload-stream/${clip.filename}`}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoaded}
                onEnded={() => setPlaying(false)}
                onError={() => {
                  // Try direct file path via a different approach
                  if (videoRef.current) {
                    videoRef.current.src = `/renders-preview/${clip.filename}`;
                  }
                }}
              />
            </div>

            {/* Transport controls */}
            <div style={{ padding: '12px 0 0' }}>
              <input type="range" className="range-input" style={{ width: '100%', marginBottom: 8 }}
                min="0" max="100" step="0.1"
                value={duration ? (currentTime / duration * 100) : 0}
                onChange={seek} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={togglePlay} style={{ padding: '6px 12px' }}>
                  {playing ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <span style={{ fontSize: 13, color: 'var(--text2)', flex: 1 }}>
                  {fmtDur(currentTime)} / {fmtDur(duration)}
                </span>
                <button className="btn btn-sm" onClick={setInPoint} title="Set In Point">
                  [IN] {fmtDur(startTime)}
                </button>
                <button className="btn btn-sm" onClick={setOutPoint} title="Set Out Point">
                  [OUT] {fmtDur(endTime)}
                </button>
              </div>
            </div>
          </div>

          {/* Trim timeline bar */}
          <div className="card">
            <div className="section-title">Trim Region</div>
            <div style={{ position: 'relative', height: 40, background: 'var(--bg3)', borderRadius: 4 }}>
              {duration > 0 && (
                <div style={{
                  position: 'absolute', height: '100%', background: 'var(--accent-dim)',
                  border: '2px solid var(--accent)', borderRadius: 4,
                  left: `${(startTime / duration) * 100}%`,
                  width: `${((endTime - startTime) / duration) * 100}%`,
                }} />
              )}
              <div style={{
                position: 'absolute', width: 2, height: '100%', background: 'white',
                left: `${duration ? (currentTime / duration * 100) : 0}%`,
              }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <label>In point (s)</label>
                <input type="number" value={startTime} step="0.1" min="0" max={endTime - 0.1}
                  onChange={e => setStartTime(parseFloat(e.target.value))} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Out point (s)</label>
                <input type="number" value={endTime} step="0.1" min={startTime + 0.1} max={clip.duration}
                  onChange={e => setEndTime(parseFloat(e.target.value))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <span style={{ fontSize: 12, color: 'var(--text2)', padding: '8px 0' }}>
                  {(endTime - startTime).toFixed(2)}s
                </span>
              </div>
            </div>
          </div>

          {/* Captions */}
          <div className="card">
            <div className="section-title">Captions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: 8, marginBottom: 8 }}>
              <input placeholder="Caption text..." value={newCaption.text}
                onChange={e => setNewCaption(p => ({ ...p, text: e.target.value }))} />
              <input type="number" placeholder="Start" value={newCaption.startTime} step="0.1"
                onChange={e => setNewCaption(p => ({ ...p, startTime: parseFloat(e.target.value) }))} />
              <input type="number" placeholder="End" value={newCaption.endTime} step="0.1"
                onChange={e => setNewCaption(p => ({ ...p, endTime: parseFloat(e.target.value) }))} />
              <button className="btn btn-primary" onClick={addCaption} disabled={!newCaption.text}>
                <Plus size={14} />
              </button>
            </div>
            {captions.map((cap, i) => (
              <div key={cap.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: 12 }}>"{cap.text}"</span>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>{cap.startTime}s–{cap.endTime}s</span>
                <button className="btn btn-sm btn-danger" onClick={() => setCaptions(p => p.filter((_, j) => j !== i))}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="editor-right">
          {/* Export Options */}
          <div className="card">
            <div className="section-title">Export Options</div>
            <div className="form-group">
              <label>Aspect Ratio</label>
              <select value={targetAspect} onChange={e => setTargetAspect(e.target.value)}>
                <option value="16:9">16:9 — Landscape (YouTube)</option>
                <option value="9:16">9:16 — Vertical (TikTok/Reels)</option>
                <option value="1:1">1:1 — Square (Instagram)</option>
                <option value="4:5">4:5 — Portrait (Instagram Feed)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Zoom Factor ({zoom.toFixed(1)}×)</label>
              <input type="range" className="range-input" style={{ width: '100%' }}
                min="1" max="3" step="0.1" value={zoom}
                onChange={e => setZoom(parseFloat(e.target.value))} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" onClick={doExport}>
                <Download size={14} /> Export Clip
              </button>
              <button className="btn" onClick={doTrim}>
                <Scissors size={14} /> Quick Trim
              </button>
              <button className="btn" onClick={doShort} style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
                <Download size={14} /> Export as Short (9:16)
              </button>
            </div>
          </div>

          {/* Live Job Progress */}
          {liveJob && (
            <div className="card">
              <div className="section-title">Rendering</div>
              <div style={{ marginBottom: 6, fontSize: 13 }}>
                <span className={`badge badge-${liveJob.status}`}>{liveJob.status}</span>
                {liveJob.message && <span style={{ marginLeft: 8, color: 'var(--text2)', fontSize: 12 }}>{liveJob.message}</span>}
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${liveJob.progress || 0}%` }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{liveJob.progress || 0}%</div>
              {liveJob.status === 'done' && liveJob.result?.outputPath && (
                <a href={liveJob.result.outputPath} download
                  style={{ display: 'block', marginTop: 8, textAlign: 'center' }}
                  className="btn btn-primary">
                  <Download size={14} /> Download Output
                </a>
              )}
              {liveJob.status === 'error' && (
                <div className="text-error text-sm" style={{ marginTop: 6 }}>{liveJob.error}</div>
              )}
            </div>
          )}

          {/* Past renders */}
          {renders.length > 0 && (
            <div className="card">
              <div className="section-title">Renders ({renders.length})</div>
              {renders.slice(0, 5).map(r => (
                <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className={`badge badge-${r.status}`}>{r.status}</span>
                    {r.duration && <span style={{ fontSize: 11, color: 'var(--text2)' }}>{r.duration?.toFixed(1)}s</span>}
                  </div>
                  {r.status === 'done' && r.outputPath && (
                    <a href={r.outputPath} download className="btn btn-sm btn-primary" style={{ marginTop: 6, display: 'inline-flex' }}>
                      <Download size={12} /> Download
                    </a>
                  )}
                  {r.status === 'running' && (
                    <div className="progress-bar" style={{ marginTop: 6 }}>
                      <div className="progress-fill" style={{ width: `${r.progress || 0}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
