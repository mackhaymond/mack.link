import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { linkAPI } from '../services/api'

// Query keys
export const linkKeys = {
  all: ['links'],
  lists: () => [...linkKeys.all, 'list'],
  list: (filters) => [...linkKeys.lists(), { filters }],
  details: () => [...linkKeys.all, 'detail'],
  detail: (id) => [...linkKeys.details(), id],
}

// Hook to fetch all links
export function useLinks(options = {}) {
  return useQuery({
    queryKey: linkKeys.lists(),
    queryFn: async () => {
      let cursor
      let merged = {}
      do {
        const page = await linkAPI.listLinks(500, cursor)
        const pageLinks = page.links || page
        merged = { ...merged, ...pageLinks }
        cursor = page.cursor
      } while (cursor)
      return merged
    },
    staleTime: 1000 * 60 * 2,
    ...options,
  })
}

// Hook to fetch a single link
export function useLink(shortcode) {
  return useQuery({
    queryKey: linkKeys.detail(shortcode),
    queryFn: () => linkAPI.getLink(shortcode),
    enabled: !!shortcode,
  })
}

// Hook to create a new link
export function useCreateLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data) => linkAPI.createLink(data),

    onMutate: async (newLink) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: linkKeys.lists() })

      // Snapshot the previous value
      const previousLinks = queryClient.getQueryData(linkKeys.lists())

      // Optimistically update to the new value
      if (previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), (old) => ({
          ...old,
          [newLink.shortcode]: {
            ...newLink,
            tags: newLink.tags || [],
            archived: !!newLink.archived,
            activatesAt: newLink.activatesAt || '',
            expiresAt: newLink.expiresAt || '',
            passwordEnabled: !!(newLink.password && newLink.password.trim()),
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            clicks: 0,
          },
        }))
      }

      return { previousLinks }
    },

    onError: (err, newLink, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), context.previousLinks)
      }
    },

    onSuccess: (data) => {
      // Update the links list with the actual server response
      queryClient.setQueryData(linkKeys.lists(), (old) => ({
        ...old,
        [data.shortcode]: data,
      }))
    },

    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: linkKeys.lists() })
    },
  })
}

// Hook to update a link
export function useUpdateLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ shortcode, updates }) => linkAPI.updateLink(shortcode, updates),

    onMutate: async ({ shortcode, updates }) => {
      await queryClient.cancelQueries({ queryKey: linkKeys.lists() })
      await queryClient.cancelQueries({ queryKey: linkKeys.detail(shortcode) })

      const previousLinks = queryClient.getQueryData(linkKeys.lists())
      const previousLink = queryClient.getQueryData(linkKeys.detail(shortcode))

      // Optimistically update
      if (previousLinks && previousLinks[shortcode]) {
        queryClient.setQueryData(linkKeys.lists(), (old) => ({
          ...old,
          [shortcode]: {
            ...old[shortcode],
            ...updates,
            passwordEnabled:
              updates.password === null
                ? false
                : updates.password
                  ? true
                  : old[shortcode].passwordEnabled,
            updated: new Date().toISOString(),
          },
        }))
      }

      if (previousLink) {
        queryClient.setQueryData(linkKeys.detail(shortcode), (old) => ({
          ...old,
          ...updates,
          updated: new Date().toISOString(),
        }))
      }

      return { previousLinks, previousLink }
    },

    onError: (err, { shortcode }, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), context.previousLinks)
      }
      if (context?.previousLink) {
        queryClient.setQueryData(linkKeys.detail(shortcode), context.previousLink)
      }
    },

    onSuccess: (data, { shortcode }) => {
      queryClient.setQueryData(linkKeys.lists(), (old) => ({
        ...old,
        [shortcode]: data,
      }))
      queryClient.setQueryData(linkKeys.detail(shortcode), data)
    },

    onSettled: (data, error, { shortcode }) => {
      queryClient.invalidateQueries({ queryKey: linkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: linkKeys.detail(shortcode) })
    },
  })
}

// Hook to delete a link
export function useDeleteLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: linkAPI.deleteLink,

    onMutate: async (shortcode) => {
      await queryClient.cancelQueries({ queryKey: linkKeys.lists() })

      const previousLinks = queryClient.getQueryData(linkKeys.lists())

      // Optimistically remove the link
      if (previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), (old) => {
          const rest = { ...old }
          delete rest[shortcode]
          return rest
        })
      }

      return { previousLinks }
    },

    onError: (err, shortcode, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), context.previousLinks)
      }
    },

    onSettled: (data, error, shortcode) => {
      queryClient.invalidateQueries({ queryKey: linkKeys.lists() })
      queryClient.removeQueries({ queryKey: linkKeys.detail(shortcode) })
    },
  })
}

// Hook to bulk delete links
export function useBulkDeleteLinks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: linkAPI.bulkDeleteLinks,

    onMutate: async (shortcodes) => {
      await queryClient.cancelQueries({ queryKey: linkKeys.lists() })

      const previousLinks = queryClient.getQueryData(linkKeys.lists())

      // Optimistically remove all selected links
      if (previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), (old) => {
          const newLinks = { ...old }
          shortcodes.forEach((shortcode) => {
            delete newLinks[shortcode]
          })
          return newLinks
        })
      }

      return { previousLinks }
    },

    onError: (err, shortcodes, context) => {
      if (context?.previousLinks) {
        queryClient.setQueryData(linkKeys.lists(), context.previousLinks)
      }
    },

    onSettled: (data, error, shortcodes) => {
      queryClient.invalidateQueries({ queryKey: linkKeys.lists() })
      // Remove individual link queries for all deleted links
      shortcodes.forEach((shortcode) => {
        queryClient.removeQueries({ queryKey: linkKeys.detail(shortcode) })
      })
    },
  })
}
