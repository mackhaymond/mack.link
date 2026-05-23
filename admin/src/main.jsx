import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { AuthCallback } from './components/AuthCallback.jsx'
import { LoginScreen } from './components/LoginScreen.jsx'
import { QueryProvider } from './providers/QueryProvider.jsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx'

import { ThemeProvider } from './providers/ThemeProvider.jsx'

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
    },
    {
      path: '/login',
      element: <LoginScreen />,
    },
    {
      path: '/auth/callback',
      element: (
        <AuthCallback
          onAuthSuccess={() => {
            // Navigation will be handled by the AuthCallback component itself
          }}
        />
      ),
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
