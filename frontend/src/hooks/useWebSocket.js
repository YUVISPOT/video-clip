import { useEffect, useRef, useState, useCallback } from 'react';
import { createWS } from '../api/client';

export function useWebSocket() {
  const ws = useRef(null);
  const [jobs, setJobs] = useState({});
  const [connected, setConnected] = useState(false);

  const updateJob = useCallback((jobId, updates) => {
    setJobs(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || {}), ...updates },
    }));
  }, []);

  useEffect(() => {
    function connect() {
      ws.current = createWS((msg) => {
        switch (msg.type) {
          case 'queue_state':
            if (Array.isArray(msg.jobs)) {
              const map = {};
              msg.jobs.forEach(j => { map[j.id] = j; });
              setJobs(map);
            }
            break;
          case 'job:queued':
          case 'job:started':
            if (msg.job) updateJob(msg.jobId, msg.job);
            break;
          case 'job:progress':
            updateJob(msg.jobId, { progress: msg.progress, message: msg.message, status: 'running' });
            break;
          case 'job:done':
            updateJob(msg.jobId, { status: 'done', progress: 100, result: msg.result });
            break;
          case 'job:error':
            updateJob(msg.jobId, { status: 'error', error: msg.error });
            break;
          case 'job:cancelled':
            updateJob(msg.jobId, { status: 'cancelled' });
            break;
        }
      });
      ws.current.onopen = () => setConnected(true);
      ws.current.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000); // reconnect
      };
    }
    connect();
    return () => { ws.current?.close(); };
  }, [updateJob]);

  return { jobs, connected };
}
