import { useState, useCallback, useMemo } from 'react'
import type { CalendarWeek } from '@/features/grid/types'

export function useWeekPagination(weeks: CalendarWeek[]) {
  const [currentIndex, setCurrentIndex] = useState(0)

  const safeIndex = Math.min(currentIndex, Math.max(0, weeks.length - 1))

  const prev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1))
  }, [])

  const next = useCallback(() => {
    setCurrentIndex((i) => Math.min(weeks.length - 1, i + 1))
  }, [weeks.length])

  const goTo = useCallback((i: number) => {
    setCurrentIndex(i)
  }, [])

  const currentWeek = weeks[safeIndex] as CalendarWeek | undefined

  return {
    currentIndex: safeIndex,
    currentWeek,
    prev,
    next,
    goTo,
    hasPrev: safeIndex > 0,
    hasNext: safeIndex < weeks.length - 1,
    total: weeks.length,
  }
}
