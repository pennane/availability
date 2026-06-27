import { useState, useCallback, useEffect, useSyncExternalStore, createContext, useContext, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

const mq = matchMedia('(prefers-color-scheme: dark)')

function getSystemTheme(): Theme {
  return mq.matches ? 'dark' : 'light'
}

function subscribeSystemTheme(cb: () => void) {
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

function getStored(): Theme | null {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : null
}

type ThemeContextValue = {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  setTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

const DARK_MODE_ENABLED = false

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemTheme)
  const [stored, setStored] = useState<Theme | null>(getStored)
  const theme = DARK_MODE_ENABLED ? (stored ?? systemTheme) : 'light'

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t)
    setStored(t)
  }, [])

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <ThemeContext value={{ theme, setTheme }}>
      {children}
    </ThemeContext>
  )
}
