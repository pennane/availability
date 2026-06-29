import { useMemo } from 'react'
import type { CalendarWeek } from '@/features/grid/types'

export function useWeekNavigation(weeks: CalendarWeek[], weekIndex: number) {
  const activeIndices = useMemo(
    () => weeks.map((w, i) => w.days.some(d => d.active) ? i : -1).filter(i => i >= 0),
    [weeks],
  )

  const rawIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1))

  const safeIndex = useMemo(() => {
    if (activeIndices.length === 0) return rawIndex
    if (activeIndices.includes(rawIndex)) return rawIndex
    return activeIndices.reduce((closest, i) =>
      Math.abs(i - rawIndex) < Math.abs(closest - rawIndex) ? i : closest,
    )
  }, [rawIndex, activeIndices])

  const activePos = activeIndices.indexOf(safeIndex)

  return {
    safeIndex,
    currentWeek: weeks[safeIndex] as CalendarWeek | undefined,
    prevActive: activePos > 0 ? activeIndices[activePos - 1] : -1,
    nextActive: activePos < activeIndices.length - 1 ? activeIndices[activePos + 1] : -1,
    hasPrev: activePos > 0,
    hasNext: activePos >= 0 && activePos < activeIndices.length - 1,
    activePosition: activePos + 1,
    activeTotal: activeIndices.length,
  }
}
