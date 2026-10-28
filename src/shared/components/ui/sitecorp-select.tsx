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
  className?: string
}

const SiteCorpSelect = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  SiteCorpSelectProps
>(({ label, error, children, className, ...props }, ref) => {
  // Native <option> children are converted into Radix SelectItems.
  // Radix forbids SelectItems with an empty string value, so options with
  // value="" are treated as placeholders and excluded from the list.
  let placeholder = "Seleccionar..."
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
        return null
      }
      return (
        <SelectItem key={optionProps.value} value={optionProps.value} disabled={optionProps.disabled}>
          {optionProps.children}
        </SelectItem>
      )
    }
    return child
  })

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-sm font-medium text-ink">{label}</label>
      )}
      <Select {...props} value={props.value ?? undefined}>
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