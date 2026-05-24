import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      cacheTime: 1000 * 60 * 10, // 10 minutes
      refetchOnWindowFocus: 'always',
      refetchOnReconnect: 'always',
      retry: (failureCount, error) => {
        // M8: don't retry any 4xx (validation / not found / forbidden / etc.)
        // Only retry network errors (TypeError from fetch) and 5xx. The shared
        // http client attaches `.status` to non-2xx errors.
        const status = error?.status
        if (typeof status === 'number' && status >= 400 && status < 500) return false
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: false, // Don't retry mutations by default
    },
  },
})

function DevtoolsLazy() {
  const [Devtools, setDevtools] = useState(null)
  useEffect(() => {
    if (import.meta.env.DEV) {
      import('@tanstack/react-query-devtools').then((m) => {
        setDevtools(() => m.ReactQueryDevtools)
      })
    }
  }, [])
  return Devtools ? <Devtools initialIsOpen={false} /> : null
}

export function QueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <DevtoolsLazy />
    </QueryClientProvider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export { queryClient }
