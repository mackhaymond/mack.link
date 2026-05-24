import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryProvider } from './providers/QueryProvider.jsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx'

import { ThemeProvider } from './providers/ThemeProvider.jsx'

// Sprint 2a (A3): /login and /auth/callback routes are gone. Cloudflare
// Access shows its own login UI before the SPA ever loads, and there's
// no OAuth callback for the SPA to handle anymore. App is the only
// route; the React Router basename keeps URLs under /admin.
const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
    },
  ],
  {
    basename: '/admin',
  }
)

// M13: top-level ErrorBoundary wraps the entire app (above the router) so
// errors thrown during route mount / providers are still recoverable.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary fallbackMessage="The admin panel hit an unexpected error. Refreshing usually fixes it.">
      <QueryProvider>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryProvider>
    </ErrorBoundary>
  </StrictMode>
)
