import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');

  // Try to load firebase-applet-config.json if it exists
  let firebaseConfig: any = {};
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load firebase-applet-config.json:', e);
  }

  // Determine if we should use the system environment variables (e.g. celcomdigi-portal)
  const useSystemEnv = !!process.env.FIREBASE_PROJECT_ID;

  let apiKey = '';
  let authDomain = '';
  let projectId = '';
  let storageBucket = '';
  let messagingSenderId = '';
  let appId = '';
  let databaseId = '';

  if (useSystemEnv) {
    apiKey = process.env.FIREBASE_API_KEY || '';
    authDomain = process.env.FIREBASE_AUTH_DOMAIN || '';
    projectId = process.env.FIREBASE_PROJECT_ID || '';
    storageBucket = process.env.FIREBASE_STORAGE_BUCKET || '';
    messagingSenderId = process.env.FIREBASE_MESSAGING_SENDER_ID || '';
    appId = process.env.FIREBASE_APP_ID || '';
    databaseId = process.env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '';
  } else {
    apiKey = env.FIREBASE_API_KEY || firebaseConfig.apiKey || '';
    authDomain = env.FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain || '';
    projectId = env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || '';
    storageBucket = env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket || '';
    messagingSenderId = env.FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId || '';
    appId = env.FIREBASE_APP_ID || firebaseConfig.appId || '';
    databaseId = env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '';
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Firebase config — injected with fallback.
      'process.env.FIREBASE_API_KEY': JSON.stringify(apiKey),
      'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(authDomain),
      'process.env.FIREBASE_PROJECT_ID': JSON.stringify(projectId),
      'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(storageBucket),
      'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(messagingSenderId),
      'process.env.FIREBASE_APP_ID': JSON.stringify(appId),
      'process.env.FIREBASE_DATABASE_ID': JSON.stringify(databaseId),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});