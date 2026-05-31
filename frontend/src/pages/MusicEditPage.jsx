import React, { useState, useEffect, useRef } from 'react';
import { Music, Upload, Play, Zap, Download, Trash2, Check, Info, RefreshCw, Activity } from 'lucide-react';
import { api } from '../api/client';
import { useJobs } from '../App';

function fmtDur(s) {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function fmtSize(b) {
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

const CUT_RATES = [
  { value: 'beat',   label: 'Every Beat',    desc: 'Fast-paced, one cut per beat. Great for hype edits.' },
  { value: 'half',   label: 'Every 2 Beats', desc: 'Slightly slower. Good for action/sports.' },
  { value: 'bar',    label: 'Every Bar',      desc: 'One cut per 4 beats. Smooth, cinematic feel.' },
  { value: 'double', label: 'Every 2 Bars',  desc: 'Slow cuts. Best for cinematic/emotional edits.' },
];

export default function MusicEditPage() {
  const songInputRef = useRef();
  const [songs, setSongs] = useState([]);
  const [clips, setClips] = useState([]);
  const [selectedSong, setSelectedSong] = useState(null);
  const [selectedClips, setSelectedClips] = useState(new Set());
  const [cutRate, setCutRate] = useState('bar');
  const [targetDuration, setTargetDuration] = useState(60);
  const [duckOriginal, setDuckOriginal] = useState(false);
  const [targetAspect, setTargetAspect] = useState('16:9');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [beatData, setBeatData] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [history, setHistory] = useState([]);
  const { jobs: liveJobs } = useJobs();

  const load = () => {
    api.getSongs().then(d => setSongs(d.songs)).catch(() => {});
    api.getClips().then(d => setClips(d.clips)).catch(() => {});
    api.getExportJobs().then(d => setHistory(d.jobs.filter(j => j.type === 'music-edit'))).catch(() => {});
  };

  useEffect(load, []);

  const uploadSong = async (file) => {
    setUploading(true); setUploadPct(0);
    try {
      const { song } = await api.uploadSong(file, (p) => setUploadPct(p));
      setSongs(prev => [song, ...prev]);
      setSelectedSong(song);
      setBeatData(null);
    } catch (e) { alert('Upload failed: ' + e.message); }
    finally { setUploading(false); }
  };

  const analyzeSong = async () => {
    if (!selectedSong) return;
    setAnalyzing(true); setBeatData(null);
    try {
      const { beatData: bd } = await api.analyzeSong(selectedSong.id);
      setBeatData(bd);
    } catch (e) { alert('Analysis failed: ' + e.message); }
    finally { setAnalyzing(false); }
  };

  const deleteSong = async (id, e) => {
    e.stopPropagation();
    await api.deleteSong(id);
    setSongs(prev => prev.filter(s => s.id !== id));
    if (selectedSong?.id === id) { setSelectedSong(null); setBeatData(null); }
  };

  const toggleClip = (id) => setSelectedClips(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const run = async () => {
    if (!selectedSong) { alert('Select a song first'); return; }
    if (!selectedClips.size) { alert('Select at least one clip'); return; }
    try {
      const [w, h] = targetAspect === '9:16' ? [1080, 1920] : targetAspect === '1:1' ? [1080, 1080] : [1920, 1080];
      const { exportJob } = await api.musicEdit({
        songId: selectedSong.id,
        clipIds: [...selectedClips],
        cutRate,
        targetDuration: parseInt(targetDuration),
        duckOriginal,
        targetAspect,
        width: w, height: h, fps: 30,
      });
      setActiveJobId(exportJob.id);
      setHistory(prev => [exportJob, ...prev]);
    } catch (e) { alert('Failed: ' + e.message); }
  };

  const liveJob = activeJobId ? liveJobs[activeJobId] : null;
  const selectedRate = CUT_RATES.find(r => r.value === cutRate);

  // Estimate cuts count
  const estimatedCuts = beatData ? {
    beat: beatData.beat_count,
    half: Math.floor(beatData.beat_count / 2),
    bar: beatData.bars?.length || Math.floor(beatData.beat_count / 4),
    double: Math.floor((beatData.bars?.length || beatData.beat_count / 4) / 2),
  }[cutRate] : null;

  return (
    <div>
      <div className="page-header">
        <h1>Music Edit</h1>
        <p>Upload a song → auto-detects BPM & beats → cuts your clips to the music automatically</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Song selector */}
          <div className="card">
            <div className="section-title">1. Choose a Song</div>

            <div
              style={{
                border: '2px dashed var(--border)', borderRadius: 8, padding: '20px',
                textAlign: 'center', cursor: 'pointer', marginBottom: 14,
                background: 'var(--bg3)', transition: 'all 0.15s',
              }}
              onClick={() => songInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onDragLeave={e => { e.currentTarget.style.borderColor = ''; }}
              onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = ''; const f = e.dataTransfer.files[0]; if (f) uploadSong(f); }}
            >
              <Music size={28} color="var(--text3)" style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Drop MP3, WAV, FLAC, M4A here</div>
              <div style={{ fontSize: 11, color: 'var(--text2)' }}>or click to browse</div>
              {uploading && (
                <div style={{ marginTop: 12 }}>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadPct}%` }} /></div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{uploadPct}% uploading...</div>
                </div>
              )}
              <input ref={songInputRef} type="file" accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac"
                style={{ display: 'none' }} onChange={e => e.target.files[0] && uploadSong(e.target.files[0])} />
            </div>

            {/* Song list */}
            {songs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {songs.map(s => (
                  <div
                    key={s.id}
                    onClick={() => { setSelectedSong(s); setBeatData(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                      borderRadius: 6, cursor: 'pointer', border: `2px solid ${selectedSong?.id === s.id ? 'var(--accent)' : 'var(--border)'}`,
                      background: selectedSong?.id === s.id ? 'var(--accent-dim)' : 'var(--bg3)',
                      transition: 'all 0.15s',
                    }}
                  >
                    <Music size={18} color={selectedSong?.id === s.id ? 'var(--accent)' : 'var(--text3)'} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.originalName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                        {s.duration ? fmtDur(s.duration) : '?'} · {fmtSize(s.fileSize)}
                      </div>
                    </div>
                    {selectedSong?.id === s.id && <Check size={16} color="var(--accent)" />}
                    <button className="btn btn-sm btn-danger" onClick={e => deleteSong(s.id, e)}><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Beat analysis */}
            {selectedSong && (
              <div style={{ marginTop: 12 }}>
                <button className="btn btn-primary" onClick={analyzeSong} disabled={analyzing}
                  style={{ width: '100%' }}>
                  {analyzing
                    ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Analyzing beats...</>
                    : <><Activity size={15} /> Analyze BPM & Beats</>}
                </button>

                {beatData && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg3)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, textAlign: 'center' }}>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>{beatData.bpm.toFixed(0)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text2)' }}>BPM</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>{beatData.beat_count}</div>
                        <div style={{ fontSize: 11, color: 'var(--text2)' }}>Beats</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtDur(beatData.duration)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text2)' }}>Length</div>
                      </div>
                    </div>

                    {/* Beat waveform visualization */}
                    <div style={{ marginTop: 12, height: 40, background: 'var(--bg2)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                      {beatData.beats.slice(0, 200).map((b, i) => (
                        <div key={i} style={{
                          position: 'absolute',
                          left: `${(b.start / beatData.duration) * 100}%`,
                          bottom: 0,
                          width: 2,
                          height: `${Math.max(20, b.strength * 100)}%`,
                          background: b.strength > 0.7 ? 'var(--accent)' : 'rgba(99,102,241,0.4)',
                          borderRadius: 1,
                        }} />
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4, textAlign: 'center' }}>
                      Beat intensity map · {estimatedCuts} cuts with current setting
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Clip selector */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0, flex: 1 }}>
                2. Select Clips ({selectedClips.size} selected)
              </div>
              <button className="btn btn-sm" onClick={() => setSelectedClips(new Set(clips.map(c => c.id)))}>All</button>
              <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => setSelectedClips(new Set())}>None</button>
            </div>

            {clips.length === 0 ? (
              <div className="text-muted text-sm">No clips uploaded yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {clips.map(c => (
                  <div
                    key={c.id}
                    onClick={() => toggleClip(c.id)}
                    style={{
                      borderRadius: 6, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                      border: `2px solid ${selectedClips.has(c.id) ? 'var(--accent)' : 'var(--border)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    {selectedClips.has(c.id) && (
                      <div style={{
                        position: 'absolute', top: 5, right: 5, zIndex: 2,
                        background: 'var(--accent)', borderRadius: '50%', width: 18, height: 18,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Check size={11} color="white" />
                      </div>
                    )}
                    {c.thumbnailPath
                      ? <img src={c.thumbnailPath} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} alt="" />
                      : <div style={{ width: '100%', aspectRatio: '16/9', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Music size={20} color="var(--text3)" />
                        </div>
                    }
                    <div style={{ padding: '5px 7px', fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.originalName}
                    </div>
                    <div style={{ padding: '0 7px 5px', fontSize: 10, color: 'var(--text2)' }}>
                      {fmtDur(c.duration)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Settings + controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card">
            <div className="section-title">3. Edit Settings</div>

            <div className="form-group">
              <label>Cut Rate</label>
              {CUT_RATES.map(r => (
                <div
                  key={r.value}
                  onClick={() => setCutRate(r.value)}
                  style={{
                    padding: '10px 12px', borderRadius: 6, marginBottom: 6, cursor: 'pointer',
                    border: `2px solid ${cutRate === r.value ? 'var(--accent)' : 'var(--border)'}`,
                    background: cutRate === r.value ? 'var(--accent-dim)' : 'var(--bg3)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {cutRate === r.value && <Check size={14} color="var(--accent)" />}
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                    {beatData && estimatedCuts && cutRate === r.value && (
                      <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 'auto' }}>
                        ~{estimatedCuts} cuts
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2, paddingLeft: cutRate === r.value ? 22 : 0 }}>
                    {r.desc}
                  </div>
                </div>
              ))}
            </div>

            <div className="form-group">
              <label>Use how much of the song</label>
              <select value={targetDuration} onChange={e => setTargetDuration(e.target.value)}>
                <option value="30">30 seconds</option>
                <option value="60">1 minute</option>
                <option value="90">90 seconds</option>
                <option value="120">2 minutes</option>
                <option value="9999">Full song</option>
              </select>
            </div>

            <div className="form-group">
              <label>Output Format</label>
              <select value={targetAspect} onChange={e => setTargetAspect(e.target.value)}>
                <option value="16:9">16:9 — YouTube</option>
                <option value="9:16">9:16 — TikTok / Reels</option>
                <option value="1:1">1:1 — Instagram Square</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, marginBottom: 14, cursor: 'pointer' }}
              onClick={() => setDuckOriginal(p => !p)}>
              <div style={{
                width: 20, height: 20, borderRadius: 4, border: `2px solid ${duckOriginal ? 'var(--accent)' : 'var(--border)'}`,
                background: duckOriginal ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {duckOriginal && <Check size={12} color="white" />}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Keep original audio (ducked)</div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>Mix original video audio quietly under the song</div>
              </div>
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: 14 }}
              onClick={run}
              disabled={!selectedSong || !selectedClips.size || (liveJob && ['pending','running'].includes(liveJob.status))}
            >
              <Zap size={16} />
              {liveJob && ['pending','running'].includes(liveJob.status) ? 'Rendering...' : 'Create Music Edit'}
            </button>

            {(!selectedSong || !selectedClips.size) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, fontSize: 11, color: 'var(--text2)' }}>
                <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  {!selectedSong && 'Upload and select a song. '}
                  {!selectedClips.size && 'Select at least one clip.'}
                </span>
              </div>
            )}
          </div>

          {/* Live progress */}
          {liveJob && (
            <div className="card">
              <div className="section-title">Rendering</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className={`badge badge-${liveJob.status}`}>{liveJob.status}</span>
                <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1 }}>{liveJob.message}</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{liveJob.progress || 0}%</span>
              </div>
              <div className="progress-bar" style={{ height: 10 }}>
                <div className="progress-fill" style={{ width: `${liveJob.progress || 0}%` }} />
              </div>

              {liveJob.status === 'done' && liveJob.result && (
                <div style={{ marginTop: 14, padding: 12, background: 'var(--bg3)', borderRadius: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, marginBottom: 10 }}>
                    <div>BPM: <strong>{liveJob.result.bpm?.toFixed(0)}</strong></div>
                    <div>Duration: <strong>{fmtDur(liveJob.result.duration)}</strong></div>
                    <div>Cuts: <strong>{liveJob.result.segmentsUsed}</strong></div>
                    <div>Rate: <strong>{liveJob.result.cutRate}</strong></div>
                  </div>
                  <a href={liveJob.result.outputPath} download
                    className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                    <Download size={15} /> Download Music Edit
                  </a>
                </div>
              )}
              {liveJob.status === 'error' && (
                <div className="text-error text-sm" style={{ marginTop: 8 }}>❌ {liveJob.error}</div>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="card">
              <div className="section-title">Past Music Edits</div>
              {history.slice(0, 6).map(j => {
                const live = liveJobs[j.id];
                const status = live?.status || j.status;
                return (
                  <div key={j.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span className={`badge badge-${status}`}>{status}</span>
                      <span style={{ fontSize: 11, color: 'var(--text2)' }}>{j.preset} cuts · {j.aspectRatio}</span>
                    </div>
                    {status === 'done' && j.outputPath && (
                      <a href={j.outputPath} download className="btn btn-sm btn-primary">
                        <Download size={12} /> Download
                      </a>
                    )}
                    {['pending','running'].includes(status) && (
                      <div className="progress-bar" style={{ marginTop: 4 }}>
                        <div className="progress-fill" style={{ width: `${live?.progress || j.progress}%` }} />
                      </div>
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
