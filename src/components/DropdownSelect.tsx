import { ChevronDown } from 'lucide-react'

export type DropdownOption = { value: string; label: string }

export function DropdownSelect({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  className = '',
  disabled = false,
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const selectedLabel = options.find(option => option.value === value)?.label ?? placeholder ?? ''
  return <details className={`dropdown-select ${className}`} onKeyDown={event => {
    if (event.key === 'Escape') event.currentTarget.removeAttribute('open')
  }}>
    <summary aria-label={ariaLabel} aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault() }}>
      <span>{selectedLabel}</span><ChevronDown size={16} aria-hidden="true" />
    </summary>
    <div className="dropdown-select-options" role="listbox" aria-label={ariaLabel}>
      {options.map(option => <button key={option.value} type="button" role="option" aria-selected={value === option.value} className={value === option.value ? 'dropdown-select-option-selected' : ''} onClick={event => {
        event.currentTarget.closest('details')?.removeAttribute('open')
        onChange(option.value)
      }}>{option.label}</button>)}
    </div>
  </details>
}
