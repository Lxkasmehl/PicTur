import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { ColorSchemeScript } from '@mantine/core';
import './index.css';
import 'leaflet/dist/leaflet.css';
import App from './App.tsx';
import { installOrgFetch } from './services/api/orgContext';

// Flask API requests carry the active research group (X-Org-Slug)
installOrgFetch();

// Custom theme with turtle conservation color scheme
const theme = createTheme({
  primaryColor: 'green',
  colors: {
    // Custom green palette (like seagrass and turtle shells)
    green: [
      '#f0fdf4',
      '#dcfce7',
      '#bbf7d0',
      '#86efac',
      '#4ade80',
      '#22c55e',
      '#16a34a',
      '#15803d',
      '#166534',
      '#14532d',
    ],
    // Custom teal palette (like ocean water)
    teal: [
      '#f0fdfa',
      '#ccfbf1',
      '#99f6e4',
      '#5eead4',
      '#2dd4bf',
      '#14b8a6',
      '#0d9488',
      '#0f766e',
      '#115e59',
      '#134e4a',
    ],
    // Custom sand/beige palette (like beach sand)
    sand: [
      '#fefdfb',
      '#fdf6e3',
      '#fae8bb',
      '#f7d794',
      '#f4c430',
      '#e6a700',
      '#cc9500',
      '#b38600',
      '#9a7700',
      '#806800',
    ],
    // Custom neutral palette
    neutral: [
      '#fafafa',
      '#f5f5f5',
      '#e5e5e5',
      '#d4d4d4',
      '#a3a3a3',
      '#737373',
      '#525252',
      '#404040',
      '#262626',
      '#171717',
    ],
  },
  defaultRadius: 'md',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  headings: {
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
  },
});

const rootElement: HTMLElement = document.getElementById('root')!;

createRoot(rootElement).render(
  <StrictMode>
    <ColorSchemeScript defaultColorScheme='auto' />
    <MantineProvider theme={theme} defaultColorScheme='auto'>
      <App />
    </MantineProvider>
  </StrictMode>
);
