import { useState, useCallback, useEffect, createContext, useContext, type ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import fi from './fi.json'

const MESSAGES: Record<string, Record<string, string>> = { fi }
const STORAGE_KEY = 'locale'
const SUPPORTED = ['en', 'fi'] as const
export type Locale = (typeof SUPPORTED)[number]

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && SUPPORTED.includes(stored as Locale)) return stored as Locale
  const nav = navigator.language.split('-')[0]
  if (SUPPORTED.includes(nav as Locale)) return nav as Locale
  return 'en'
}

type LocaleContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  supported: readonly Locale[]
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  setLocale: () => {},
  supported: SUPPORTED,
})

export function useLocale() {
  return useContext(LocaleContext)
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale)

  const setLocale = useCallback((l: Locale) => {
    localStorage.setItem(STORAGE_KEY, l)
    setLocaleState(l)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <LocaleContext value={{ locale, setLocale, supported: SUPPORTED }}>
      <IntlProvider locale={locale} messages={MESSAGES[locale]} defaultLocale="en">
        {children}
      </IntlProvider>
    </LocaleContext>
  )
}
