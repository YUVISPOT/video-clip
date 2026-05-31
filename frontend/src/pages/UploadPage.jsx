import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, XCircle, Film } from 'lucide-react';
import { api } from '../api/client';

export default function UploadPage() {
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]);
  const inputRef = useRef();
  const navigate = useNavigate();

  const handleFiles = useCallback((files) => {
    const valid = Array.from(files).filter(f => f.type.startsWith('video/') ||
      /\.(mp4|mov|avi|webm|mkv|mpg|mpeg|flv|3gp)$/i.test(f.name));
    if (!valid.length) { alert('Please upload video files only.'); return; }

    valid.forEach(file => {
      const id = Math.random().toString(36).slice(2);
      setUploads(p => [...p, { id, name: file.name, size: file.size, status: 'uploading', progress: 0, clip: null, error: null }]);

      api.uploadVideo(file, null, (pct) => {
        setUploads(p => p.map(u => u.id === id ? { ...u, progress: pct } : u));
      })
        .then(({ clip }) => {
          setUploads(p => p.map(u => u.id === id ? { ...u, status: 'done', progress: 100, clip } : u));
        })
        .catch(err => {
          setUploads(p => p.map(u => u.id === id ? { ...u, status: 'error', error: err.message } : u));
        });
    });
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const fmt = (bytes) => {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    return (bytes / 1e3).toFixed(0) + ' KB';
  };

  return (
    <div>
      <div className="page-header">
        <h1>Upload Videos</h1>
        <p>Upload gameplay footage and video clips to start editing</p>
      </div>

      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <div className="upload-zone-icon"><Upload size={40} /></div>
        <h3>Drag & drop video files here</h3>
        <p>MP4, MOV, AVI, WebM, MKV — up to 4 GB each</p>
        <button className="btn-primary" style={{ marginTop: 16 }} onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>
          Choose Files
        </button>
        <input ref={inputRef} type="file" accept="video/*" multiple style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {uploads.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="section-title">Uploads</div>
          {uploads.map(u => (
            <div key={u.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Film size={16} color="var(--text2)" />
                <span style={{ flex: 1, fontWeight: 500 }}>{u.name}</span>
                <span className="text-muted text-sm">{fmt(u.size)}</span>
                {u.status === 'done' && <CheckCircle size={16} color="var(--success)" />}
                {u.status === 'error' && <XCircle size={16} color="var(--error)" />}
              </div>
              {u.status === 'uploading' && (
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${u.progress}%` }} />
                </div>
              )}
              {u.status === 'error' && (
                <div className="text-error text-sm" style={{ marginTop: 4 }}>{u.error}</div>
              )}
              {u.status === 'done' && u.clip && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span className="text-muted text-sm">
                    {u.clip.duration?.toFixed(1)}s · {u.clip.width}×{u.clip.height} · {u.clip.codec}
                  </span>
                  <button className="btn btn-sm btn-primary" onClick={() => navigate(`/editor/${u.clip.id}`)}>
                    Edit
                  </button>
                  <button className="btn btn-sm" onClick={() => navigate('/clips')}>
                    View in Library
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
