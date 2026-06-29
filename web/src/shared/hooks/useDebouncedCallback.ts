import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number
): { call: (...args: Args) => void; flush: () => void } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const argsRef = useRef<Args | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const call = useCallback(
    (...args: Args) => {
      argsRef.current = args
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        argsRef.current = null
        callbackRef.current(...args)
      }, delay)
    },
    [delay]
  )

  const flush = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    if (argsRef.current !== null) {
      const args = argsRef.current
      argsRef.current = null
      callbackRef.current(...args)
    }
  }, [])

  return { call, flush }
}
