import { useMemo } from 'react'
import {
  Calendar,
  CalendarGrid,
  CalendarGridHeader,
  CalendarGridBody,
  CalendarHeaderCell,
  CalendarCell,
  CalendarHeading,
  Button,
} from 'react-aria-components'
import { FormattedMessage, useIntl } from 'react-intl'
import { today, getLocalTimeZone, parseDate } from '@internationalized/date'
import type { DateValue } from 'react-aria-components'

type Props = {
  selected: string[]
  onChange: (dates: string[]) => void
}

export function DatePicker({ selected, onChange }: Props) {
  const intl = useIntl()
  const calendarDates = useMemo(
    () => selected.map(parseDate),
    [selected],
  )

  const minDate = today(getLocalTimeZone())

  return (
    <Calendar
      aria-label={intl.formatMessage({ id: 'create.fieldDates', defaultMessage: 'Dates' })}
      selectionMode="multiple"
      firstDayOfWeek="mon"
      value={calendarDates}
      onChange={(dates: readonly DateValue[]) => {
        onChange(dates.map((d) => d.toString()).sort())
      }}
      minValue={minDate}
    >
      <div className="flex items-center justify-between mb-2">
        <Button
          slot="previous"
          className="p-1.5 hover:bg-gray-100 rounded text-gray-600"
          aria-label="Previous month"
        >
          &larr;
        </Button>
        <CalendarHeading className="text-sm font-medium" />
        <Button
          slot="next"
          className="p-1.5 hover:bg-gray-100 rounded text-gray-600"
          aria-label="Next month"
        >
          &rarr;
        </Button>
      </div>

      <CalendarGrid weekdayStyle="short" className="w-full">
        <CalendarGridHeader>
          {(day) => (
            <CalendarHeaderCell className="text-center text-[10px] text-gray-400 font-medium pb-1">
              {day}
            </CalendarHeaderCell>
          )}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => (
            <CalendarCell
              date={date}
              className={({ isSelected, isDisabled, isOutsideMonth, isToday }) => `
                h-9 w-full text-sm rounded-sm text-center outline-none transition-colors
                ${isSelected ? 'bg-blue-500 text-white' : ''}
                ${isDisabled ? 'text-gray-300 cursor-not-allowed' : isOutsideMonth ? 'text-gray-300' : 'cursor-pointer hover:bg-gray-100'}
                ${isToday && !isSelected ? 'font-bold text-blue-600' : ''}
                focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1
              `}
            />
          )}
        </CalendarGridBody>
      </CalendarGrid>

      {selected.length > 0 && (
        <p className="mt-2 text-xs text-gray-500">
          <FormattedMessage id="create.daysSelected" defaultMessage="{count, plural, one {# day} other {# days}} selected" values={{ count: selected.length }} />
        </p>
      )}
    </Calendar>
  )
}
