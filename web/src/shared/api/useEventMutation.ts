import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useEventMutation<T = void>(
  eventId: string,
  mutationFn: (params: T) => Promise<unknown>,
  options?: {
    alsoInvalidateMe?: boolean
    onSuccess?: () => void | Promise<void>
  }
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['event', eventId] })
      if (options?.alsoInvalidateMe) {
        await queryClient.invalidateQueries({
          queryKey: ['event', eventId, 'me']
        })
      }
      await options?.onSuccess?.()
    }
  })
}
