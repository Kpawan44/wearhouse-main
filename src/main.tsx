import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { seedDatabaseIfEmpty } from './firebase';

// Seeding Firestore database if empty on bootup
seedDatabaseIfEmpty();

// Clean up any previously registered Service Worker to prevent conflicts with Vite dev assets
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then(() => {
        console.log('Unregistered active service worker to avoid dev conflicts');
      });
    }
  }).catch((err) => {
    console.warn('Error clearing service workers:', err);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
