import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

let _id = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++_id;
    setToasts(p => [...p, { id, message, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), duration);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
