import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { hashToView, LaciEditor, viewToHash } from '@lacijs/editor';
import '@lacijs/editor/style.css';
import './studio.css';

// The page is kept in the URL hash, so a reload stays where it was.
const initialView = hashToView(window.location.hash);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LaciEditor
      apiUrl="api/"
      {...(initialView ? { initialView } : {})}
      onNavigate={(view) => {
        history.replaceState(null, '', viewToHash(view));
      }}
    />
  </StrictMode>,
);
