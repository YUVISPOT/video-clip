const BASE = '/api';

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const r = await fetch(BASE + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export const api = {
  // Clips
  getClips: (params = {}) => req('GET', '/clips' + (params.projectId ? `?projectId=${params.projectId}` : '')),
  getClip: (id) => req('GET', `/clips/${id}`),
  deleteClip: (id) => req('DELETE', `/clips/${id}`),
  trimClip: (id, startTime, endTime) => req('POST', `/clips/${id}/trim`, { startTime, endTime }),
  getHighlights: (id, opts = {}) => req('POST', `/clips/${id}/highlights`, opts),
  getClipRenders: (id) => req('GET', `/clips/${id}/renders`),

  // Upload
  uploadVideo: (file, projectId, onProgress) => {
    const fd = new FormData();
    fd.append('video', file);
    if (projectId) fd.append('projectId', projectId);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', BASE + '/upload');
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(data.error || `HTTP ${xhr.status}`));
        else resolve(data);
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(fd);
    });
  },

  // Renders
  getRenders: () => req('GET', '/renders'),
  getRender: (id) => req('GET', `/renders/${id}`),
  deleteRender: (id) => req('DELETE', `/renders/${id}`),
  validateRender: (id) => req('POST', `/renders/${id}/validate`),

  // Export
  exportClip: (body) => req('POST', '/export/clip', body),
  exportMontage: (body) => req('POST', '/export/montage', body),
  exportShort: (body) => req('POST', '/export/short', body),
  getExportJobs: () => req('GET', '/export/jobs'),
  getExportJob: (id) => req('GET', `/export/jobs/${id}`),
  deleteExportJob: (id) => req('DELETE', `/export/jobs/${id}`),

  // Projects
  getProjects: () => req('GET', '/projects'),
  getProject: (id) => req('GET', `/projects/${id}`),
  createProject: (body) => req('POST', '/projects', body),
  updateProject: (id, body) => req('PATCH', `/projects/${id}`, body),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),

  autoMontage: (body) => req('POST', '/export/auto-montage', body),

  // Music
  uploadSong: (file, onProgress) => {
    const fd = new FormData();
    fd.append('audio', file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', BASE + '/music/upload');
      if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded/e.total*100)); };
      xhr.onload = () => { const d = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new Error(d.error)); else resolve(d); };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(fd);
    });
  },
  getSongs: () => req('GET', '/music/songs'),
  deleteSong: (id) => req('DELETE', `/music/songs/${id}`),
  analyzeSong: (songId) => req('POST', '/music/analyze', { songId }),
  musicEdit: (body) => req('POST', '/music/edit', body),

  // Health
  health: () => req('GET', '/health'),
};

// WebSocket hook helper
export function createWS(onMessage) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };
  return ws;
}
