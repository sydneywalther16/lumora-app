import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { LumoraThemeProvider } from './hooks/useLumoraTheme';
import { initializeNativeApp } from './lib/nativeApp';
import './styles/global.css';

initializeNativeApp();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LumoraThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LumoraThemeProvider>
  </React.StrictMode>,
);


if (!document.documentElement.classList.contains('is-native') && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
