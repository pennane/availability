import { useState } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { TextField, Input, Label } from 'react-aria-components'
import { FormattedMessage, useIntl } from 'react-intl'
import { api } from '@/shared/api/client'
import { setToken, getKnownEvents } from '@/shared/api/token'
import { Button } from '@/shared/ui/Button'
import { LocaleSwitcher } from '@/shared/i18n/LocaleSwitcher'
import { ThemeSwitcher } from '@/shared/theme/ThemeSwitcher'
import { DatePicker } from './DatePicker'

export function CreateEventPage() {
  const navigate = useNavigate()
  const intl = useIntl()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [durationMinutes, setDurationMinutes] = useState<15 | 30 | 60>(30)
  const [rangeStart, setRangeStart] = useState('09:00')
  const [rangeEnd, setRangeEnd] = useState('17:00')
  const [visibility, setVisibility] = useState<'names-visible' | 'anonymous'>('names-visible')
  const [suggestions, setSuggestions] = useState<'open' | 'closed'>('open')
  const [dates, setDates] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!title || dates.length === 0) return
    setSubmitting(true)

    const { data, error } = await api.POST('/events', {
      body: {
        title,
        description: description || undefined,
        timezone,
        timeSlotConfig: { durationMinutes, rangeStart, rangeEnd },
        visibility: { kind: visibility },
        suggestions: { kind: suggestions },
        dates,
      },
    })

    if (error || !data) {
      setSubmitting(false)
      return
    }

    setToken(data.eventId, data.hostToken)
    navigate({ to: '/events/$eventId', params: { eventId: data.eventId } })
  }

  const knownEvents = getKnownEvents()

  return (
    <div className="max-w-lg mx-auto p-4">
      {knownEvents.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            <FormattedMessage id="create.yourEvents" defaultMessage="Your events" />
          </h2>
          <ul className="space-y-1">
            {knownEvents.map((e) => (
              <li key={e.eventId}>
                <Link
                  to="/events/$eventId"
                  params={{ eventId: e.eventId }}
                  className="block px-3 py-2 rounded hover:bg-gray-100 transition-colors"
                >
                  <span className="text-sm font-medium text-gray-800">{e.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold"><FormattedMessage id="create.title" defaultMessage="Create Event" /></h1>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <LocaleSwitcher />
        </div>
      </div>

      <TextField className="mb-4" value={title} onChange={setTitle}>
        <Label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldTitle" defaultMessage="Title" /></Label>
        <Input className="w-full border rounded px-3 py-2" />
      </TextField>

      <TextField className="mb-4" value={description} onChange={setDescription}>
        <Label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldDescription" defaultMessage="Description (optional)" /></Label>
        <Input className="w-full border rounded px-3 py-2" />
      </TextField>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldTimezone" defaultMessage="Timezone" /></label>
        <p className="text-sm text-gray-600">{timezone}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldGranularity" defaultMessage="Granularity" /></label>
          <select
            className="w-full border rounded px-3 py-2"
            value={durationMinutes}
            onChange={e => setDurationMinutes(Number(e.target.value) as 15 | 30 | 60)}
          >
            <option value={15}>{intl.formatMessage({ id: 'create.min15', defaultMessage: '15 min' })}</option>
            <option value={30}>{intl.formatMessage({ id: 'create.min30', defaultMessage: '30 min' })}</option>
            <option value={60}>{intl.formatMessage({ id: 'create.min60', defaultMessage: '60 min' })}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldFrom" defaultMessage="From" /></label>
          <input
            type="time"
            step={900}
            className="w-full border rounded px-3 py-2"
            value={rangeStart}
            onChange={e => setRangeStart(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldTo" defaultMessage="To" /></label>
          <input
            type="time"
            step={900}
            className="w-full border rounded px-3 py-2"
            value={rangeEnd}
            onChange={e => setRangeEnd(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldNames" defaultMessage="Names" /></label>
          <select
            className="w-full border rounded px-3 py-2"
            value={visibility}
            onChange={e => setVisibility(e.target.value as 'names-visible' | 'anonymous')}
          >
            <option value="names-visible">{intl.formatMessage({ id: 'create.namesVisible', defaultMessage: 'Visible' })}</option>
            <option value="anonymous">{intl.formatMessage({ id: 'create.namesAnonymous', defaultMessage: 'Anonymous' })}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1"><FormattedMessage id="create.fieldDateSuggestions" defaultMessage="Date suggestions" /></label>
          <select
            className="w-full border rounded px-3 py-2"
            value={suggestions}
            onChange={e => setSuggestions(e.target.value as 'open' | 'closed')}
          >
            <option value="open">{intl.formatMessage({ id: 'create.suggestionsOpen', defaultMessage: 'Open' })}</option>
            <option value="closed">{intl.formatMessage({ id: 'create.suggestionsClosed', defaultMessage: 'Closed' })}</option>
          </select>
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2"><FormattedMessage id="create.fieldDates" defaultMessage="Dates" /></label>
        <DatePicker selected={dates} onChange={setDates} />
      </div>

      <Button
        size="lg"
        disabled={!title || dates.length === 0 || submitting}
        onClick={submit}
      >
        {submitting ? <FormattedMessage id="create.submitting" defaultMessage="Creating..." /> : <FormattedMessage id="create.submit" defaultMessage="Create Event" />}
      </Button>
    </div>
  )
}
