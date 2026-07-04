import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { useAuth } from './store/auth';
import { initAuthSync } from './store/authSync';

// 認証状態の購読を開始（supabase===null なら即 guest、あれば getSession+onAuthStateChange）
useAuth.getState().init();
initAuthSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
