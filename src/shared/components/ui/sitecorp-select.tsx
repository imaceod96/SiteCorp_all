import * as React from "react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select"

import { cn } from "@/lib/utils"

interface SiteCorpSelectProps extends React.ComponentPropsWithoutRef<typeof Select> {
  label?: string
  error?: string
  placeholder?: string
  className?: string
}

const EMPTY_SELECT_VALUE = "__empty_val__"

const SiteCorpSelect = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  SiteCorpSelectProps
>(({ label, error, placeholder: placeholderProp, children, className, name, value, defaultValue, onValueChange, required, ...props }, ref) => {
  const isControlled = value !== undefined
  const [uncontrolledValue, setUncontrolledValue] = React.useState<string>(() =>
    defaultValue === undefined || defaultValue === null ? "" : String(defaultValue)
  )

  React.useEffect(() => {
    if (!isControlled) {
      setUncontrolledValue(
        defaultValue === undefined || defaultValue === null ? "" : String(defaultValue)
      )
    }
  }, [defaultValue, isControlled])

  const currentValue = isControlled
    ? value === null || value === undefined
      ? ""
      : String(value)
    : uncontrolledValue

  // Native <option> children are converted into Radix SelectItems.
  // Radix forbids SelectItems with an empty string value, so options with
  // value="" use EMPTY_SELECT_VALUE when optional (allowing the user to clear
  // the selection) and set the placeholder text.
  let placeholder = placeholderProp ?? "Seleccionar..."
  const items = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === "option") {
      const optionProps = child.props as {
        value: string
        disabled?: boolean
        children: React.ReactNode
      }
      if (optionProps.value === "") {
        if (typeof optionProps.children === "string" && optionProps.children.trim() !== "") {
          placeholder = optionProps.children
        }
        if (required) {
          return null
        }
        return (
          <SelectItem key={EMPTY_SELECT_VALUE} value={EMPTY_SELECT_VALUE} disabled={optionProps.disabled}>
            {optionProps.children}
          </SelectItem>
        )
      }
      return (
        <SelectItem key={optionProps.value} value={optionProps.value} disabled={optionProps.disabled}>
          {optionProps.children}
        </SelectItem>
      )
    }
    return child
  })

  const handleValueChange = (nextRaw: string) => {
    const nextValue = nextRaw === EMPTY_SELECT_VALUE ? "" : nextRaw
    if (!isControlled) {
      setUncontrolledValue(nextValue)
    }
    onValueChange?.(nextValue)
  }

  const radixValue = currentValue === "" ? undefined : currentValue

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-ink">{label}</label>
      )}
      {name && <input type="hidden" name={name} value={currentValue} />}
      <Select
        {...props}
        required={required}
        value={radixValue}
        onValueChange={handleValueChange}
      >
        <SelectTrigger
          ref={ref}
          className={cn(
            "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sitecorp-primary",
            error && "border-sitecorp-danger",
            className
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent align="start" sideOffset={4}>
          {items}
        </SelectContent>
      </Select>
      {error && (
        <p className="text-xs text-sitecorp-danger">{error}</p>
      )}
    </div>
  )
})
SiteCorpSelect.displayName = "SiteCorpSelect"

export { SiteCorpSelect }