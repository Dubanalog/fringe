import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ThemeProvider } from './theme/ThemeProvider';
// The wordmark's typeface, bundled so the app needs no connection.
import '@fontsource/plus-jakarta-sans/latin-800.css';
import './styles/themes.css';
import './styles/app.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
