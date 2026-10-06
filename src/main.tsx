import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// TEMPORARY — FIND-56 pass 2 verification. Remove this import and delete
// src/TEMP_find56b_console_test.ts once the test has been run.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
