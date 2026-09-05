import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProvider, createServices } from './app/context';
import { config } from './config';
import { routes } from './routes';
import { TooltipProvider } from '@/components/ui/tooltip';
import './styles.css';

const services = createServices(config, {
  origin: window.location.origin,
  local: storage(() => window.localStorage),
  session: storage(() => window.sessionStorage),
  assign: (url) => window.location.assign(url),
});

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');

createRoot(root).render(
  <StrictMode>
    <AppProvider services={services}>
      <TooltipProvider>
        <RouterProvider router={createBrowserRouter(routes)} />
      </TooltipProvider>
    </AppProvider>
  </StrictMode>,
);

/** Browser storage, or nothing where the browser refuses it. */
function storage(get: () => Storage): Storage | undefined {
  try {
    return get();
  } catch {
    return undefined;
  }
}
