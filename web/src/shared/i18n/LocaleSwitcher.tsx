import { useLocale, type Locale } from './LocaleProvider'

const LABELS: Record<Locale, string> = {
  en: 'EN',
  fi: 'FI',
}

export function LocaleSwitcher() {
  const { locale, setLocale, supported } = useLocale()

  return (
    <div className="inline-flex rounded border border-gray-200 text-xs overflow-hidden">
      {supported.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`px-2 py-0.5 cursor-pointer transition-colors ${
            l === locale
              ? 'bg-gray-800 text-white'
              : 'bg-white text-gray-500 hover:bg-gray-100'
          }`}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
