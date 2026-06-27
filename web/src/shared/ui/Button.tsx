import type { ComponentProps } from 'react'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}

const variants = {
  primary: 'bg-blue-600 text-white',
  secondary:
    'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 border',
  danger: 'text-red-600 hover:bg-red-50 border'
}

const sizes = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-3 py-1',
  lg: 'w-full py-3 font-medium'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`rounded disabled:opacity-50 cursor-pointer ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  )
}
