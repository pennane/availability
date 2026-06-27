import { useLocale, type Locale } from './LocaleProvider'

const LABELS: Record<Locale, string> = {
  en: 'EN',
  fi: 'FI',
}

export function LocaleSwitcher() {
  const { locale, setLocale, supported } = useLocale()

  return (
    <div className="inline-flex rounded border border-gray-200 dark:border-gray-700 text-xs overflow-hidden">
      {supported.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`px-2 py-0.5 cursor-pointer transition-colors ${
            l === locale
              ? 'bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900'
              : 'bg-white text-gray-500 hover:bg-gray-100 dark:bg-neutral-900 dark:text-gray-400 dark:hover:bg-neutral-800'
          }`}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  )
}
