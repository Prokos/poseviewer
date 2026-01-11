import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ImageCacheProvider } from './features/imageCache/ImageCacheContext';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ImageCacheProvider>
      <App />
    </ImageCacheProvider>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore registration errors (e.g. localhost dev without SW support).
    });
  });
}
