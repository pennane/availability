import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { TextField, Input, Label } from 'react-aria-components'
import { api } from '@/shared/api/client'
import { setToken } from '@/shared/api/token'

export function CreateEventPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [durationMinutes, setDurationMinutes] = useState<15 | 30 | 60>(30)
  const [rangeStart, setRangeStart] = useState('09:00')
  const [rangeEnd, setRangeEnd] = useState('17:00')
  const [visibility, setVisibility] = useState<'names-visible' | 'anonymous'>('names-visible')
  const [suggestions, setSuggestions] = useState<'open' | 'closed'>('open')
  const [dates, setDates] = useState<string[]>([])
  const [dateInput, setDateInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const addDate = () => {
    if (dateInput && !dates.includes(dateInput)) {
      setDates([...dates, dateInput].sort())
      setDateInput('')
    }
  }

  const removeDate = (date: string) => {
    setDates(dates.filter(d => d !== date))
  }

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

  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Create Event</h1>

      <TextField className="mb-4" value={title} onChange={setTitle}>
        <Label className="block text-sm font-medium mb-1">Title</Label>
        <Input className="w-full border rounded px-3 py-2" />
      </TextField>

      <TextField className="mb-4" value={description} onChange={setDescription}>
        <Label className="block text-sm font-medium mb-1">Description (optional)</Label>
        <Input className="w-full border rounded px-3 py-2" />
      </TextField>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Timezone</label>
        <p className="text-sm text-gray-600">{timezone}</p>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">Duration</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={durationMinutes}
            onChange={e => setDurationMinutes(Number(e.target.value) as 15 | 30 | 60)}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">From</label>
          <input
            type="time"
            className="w-full border rounded px-3 py-2"
            value={rangeStart}
            onChange={e => setRangeStart(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">To</label>
          <input
            type="time"
            className="w-full border rounded px-3 py-2"
            value={rangeEnd}
            onChange={e => setRangeEnd(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium mb-1">Names</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={visibility}
            onChange={e => setVisibility(e.target.value as 'names-visible' | 'anonymous')}
          >
            <option value="names-visible">Visible</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Date suggestions</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={suggestions}
            onChange={e => setSuggestions(e.target.value as 'open' | 'closed')}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-1">Dates</label>
        <div className="flex gap-2 mb-2">
          <input
            type="date"
            className="flex-1 border rounded px-3 py-2"
            value={dateInput}
            onChange={e => setDateInput(e.target.value)}
          />
          <button className="px-4 py-2 bg-blue-500 text-white rounded" onClick={addDate}>
            Add
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {dates.map(d => (
            <span key={d} className="inline-flex items-center gap-1 bg-gray-100 rounded px-2 py-1 text-sm">
              {d}
              <button className="text-gray-500 hover:text-red-500" onClick={() => removeDate(d)}>
                &times;
              </button>
            </span>
          ))}
        </div>
      </div>

      <button
        className="w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
        disabled={!title || dates.length === 0 || submitting}
        onClick={submit}
      >
        {submitting ? 'Creating...' : 'Create Event'}
      </button>
    </div>
  )
}
