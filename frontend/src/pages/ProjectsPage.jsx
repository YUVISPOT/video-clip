import React, { useState, useEffect } from 'react';
import { Layers, Plus, Trash2, Edit2, Check, X } from 'lucide-react';
import { api } from '../api/client';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');

  const load = () => api.getProjects().then(d => setProjects(d.projects)).catch(() => {});
  useEffect(load, []);

  const create = async () => {
    if (!newName.trim()) return;
    await api.createProject({ name: newName.trim(), description: newDesc.trim() || null });
    setNewName(''); setNewDesc(''); setCreating(false);
    load();
  };

  const del = async (id) => {
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id);
    load();
  };

  const saveEdit = async (id) => {
    if (!editName.trim()) return;
    await api.updateProject(id, { name: editName.trim() });
    setEditId(null);
    load();
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1>Projects</h1>
          <p>Organise clips and timelines into projects</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={15} /> New Project</button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">New Project</div>
          <div className="form-group"><label>Name</label>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="My Gameplay Montage" autoFocus
              onKeyDown={e => e.key === 'Enter' && create()} /></div>
          <div className="form-group"><label>Description (optional)</label>
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional description" /></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={create} disabled={!newName.trim()}><Check size={14} /> Create</button>
            <button onClick={() => setCreating(false)}><X size={14} /> Cancel</button>
          </div>
        </div>
      )}

      {projects.length === 0 && !creating ? (
        <div className="empty">
          <Layers size={48} />
          <p>No projects yet</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setCreating(true)}>
            <Plus size={14} /> Create First Project
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {projects.map(p => (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Layers size={20} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editId === p.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(p.id); if (e.key === 'Escape') setEditId(null); }}
                        autoFocus style={{ flex: 1 }} />
                      <button className="btn btn-sm btn-primary" onClick={() => saveEdit(p.id)}><Check size={12} /></button>
                      <button className="btn btn-sm" onClick={() => setEditId(null)}><X size={12} /></button>
                    </div>
                  ) : (
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                  )}
                  {p.description && <div className="text-muted text-sm" style={{ marginTop: 2 }}>{p.description}</div>}
                  <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12, color: 'var(--text2)' }}>
                    <span>{p._count?.clips ?? 0} clips</span>
                    <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button className="btn btn-sm" onClick={() => { setEditId(p.id); setEditName(p.name); }}>
                  <Edit2 size={12} /> Rename
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => del(p.id)}>
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
