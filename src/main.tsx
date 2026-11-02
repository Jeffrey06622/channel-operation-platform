import './polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { installBootGuard, markBooted } from './bootGuard';
import './index.css';

installBootGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

markBooted();
