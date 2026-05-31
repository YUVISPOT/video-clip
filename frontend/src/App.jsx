import React, { createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Film, Upload, Scissors, Package, Layers, Activity, Zap, Music } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import UploadPage from './pages/UploadPage';
import ClipsPage from './pages/ClipsPage';
import EditorPage from './pages/EditorPage';
import ExportPage from './pages/ExportPage';
import ProjectsPage from './pages/ProjectsPage';
import JobsPage from './pages/JobsPage';
import AutoMontagePage from './pages/AutoMontagePage';
import MusicEditPage from './pages/MusicEditPage';
import './index.css';

export const WSContext = createContext({ jobs: {}, connected: false });
export function useJobs() { return useContext(WSContext); }

function Nav() {
  const { connected, jobs } = useContext(WSContext);
  const running = Object.values(jobs).filter(j => j.status === 'running').length;
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <Film size={24} />
        <span>ClipStudio</span>
      </div>
      <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Upload size={18} /> Upload
      </NavLink>
      <NavLink to="/clips" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Film size={18} /> Clips
      </NavLink>
      <NavLink to="/editor" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Scissors size={18} /> Editor
      </NavLink>
      <NavLink to="/auto" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Zap size={18} /> Auto Montage
      </NavLink>
      <NavLink to="/music" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Music size={18} /> Music Edit
      </NavLink>
      <NavLink to="/export" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Package size={18} /> Export
      </NavLink>
      <NavLink to="/projects" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Layers size={18} /> Projects
      </NavLink>
      <NavLink to="/jobs" className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
        <Activity size={18} /> Jobs
        {running > 0 && (
          <span style={{ background: 'var(--accent)', color: 'white', borderRadius: 10, padding: '1px 6px', fontSize: 10, marginLeft: 4 }}>
            {running}
          </span>
        )}
      </NavLink>
      <div className={`ws-status ${connected ? 'connected' : 'disconnected'}`}>
        <span className="ws-dot" />
        {connected ? 'Live' : 'Offline'}
      </div>
    </nav>
  );
}

export default function App() {
  const ws = useWebSocket();
  return (
    <WSContext.Provider value={ws}>
      <BrowserRouter>
        <div className="app-layout">
          <Nav />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<UploadPage />} />
              <Route path="/clips" element={<ClipsPage />} />
              <Route path="/editor" element={<EditorPage />} />
              <Route path="/editor/:clipId" element={<EditorPage />} />
              <Route path="/auto" element={<AutoMontagePage />} />
              <Route path="/music" element={<MusicEditPage />} />
              <Route path="/export" element={<ExportPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/jobs" element={<JobsPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </WSContext.Provider>
  );
}
