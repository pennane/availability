import { useEffect, useRef, type ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import type { GridRow, CalendarDay, CalendarWeek } from '@/features/grid/types'
import { TimeLabels } from './TimeLabels'

type WeekGridShellProps = {
  weeks: CalendarWeek[]
  rows: GridRow[]
  weekIndex: number
  onWeekIndexChange?: (index: number) => void
  renderWeek: (week: CalendarWeek, prevDayRef: { current: CalendarDay | undefined }) => ReactNode
  children?: ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>

export function WeekGridShell({
  weeks,
  rows,
  weekIndex,
  onWeekIndexChange,
  renderWeek,
  children,
  ...rest
}: WeekGridShellProps) {
  const intl = useIntl()
  const desktopScrollRef = useRef<HTMLDivElement>(null)
  const safeIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1))
  const currentWeek = weeks[safeIndex] as CalendarWeek | undefined
  const hasPrev = safeIndex > 0
  const hasNext = safeIndex < weeks.length - 1

  useEffect(() => {
    const container = desktopScrollRef.current
    if (!container || container.clientWidth === 0) return
    const inner = container.firstElementChild as HTMLElement | null
    if (!inner) return
    const weekEl = inner.children[safeIndex + 1] as HTMLElement
    if (!weekEl) return
    const containerRect = container.getBoundingClientRect()
    const weekRect = weekEl.getBoundingClientRect()
    const labelWidth = (inner.children[0] as HTMLElement).offsetWidth
    container.scrollTo({
      left: container.scrollLeft + weekRect.left - containerRect.left - labelWidth,
      behavior: 'smooth',
    })
  }, [safeIndex])

  const prevDayRef = { current: undefined as CalendarDay | undefined }

  return (
    <div {...rest}>
      <div className="hidden sm:block">
        <div ref={desktopScrollRef} className="overflow-auto max-h-[70vh] border border-grid-border-strong rounded">
          <div className="flex">
            <TimeLabels rows={rows} />
            {(() => { prevDayRef.current = undefined; return null })()}
            {weeks.map((week) => renderWeek(week, prevDayRef))}
          </div>
        </div>
      </div>

      <div className="sm:hidden">
        {onWeekIndexChange && weeks.length > 1 && (
          <div className="flex items-center justify-between mb-1">
            <button
              onClick={() => onWeekIndexChange(safeIndex - 1)}
              disabled={!hasPrev}
              className="p-1.5 text-grid-text-muted hover:bg-grid-empty-hover rounded disabled:opacity-30"
              aria-label={intl.formatMessage({ id: 'grid.previousWeek', defaultMessage: 'Previous week' })}
            >
              &larr;
            </button>
            <span className="text-xs text-grid-text-muted font-medium">
              <FormattedMessage id="grid.weekOf" defaultMessage="Week {current} / {total}" values={{ current: safeIndex + 1, total: weeks.length }} />
            </span>
            <button
              onClick={() => onWeekIndexChange(safeIndex + 1)}
              disabled={!hasNext}
              className="p-1.5 text-grid-text-muted hover:bg-grid-empty-hover rounded disabled:opacity-30"
              aria-label={intl.formatMessage({ id: 'grid.nextWeek', defaultMessage: 'Next week' })}
            >
              &rarr;
            </button>
          </div>
        )}
        <div className="overflow-auto max-h-[70vh] border border-grid-border-strong rounded">
          <div className="flex">
            <TimeLabels rows={rows} />
            {(() => { prevDayRef.current = undefined; return null })()}
            {currentWeek && renderWeek(currentWeek, prevDayRef)}
          </div>
        </div>
      </div>

      {children}
    </div>
  )
}
