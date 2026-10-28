import * as React from "react"

import { Checkbox } from "@/shared/components/ui/checkbox"

interface SiteCorpCheckboxProps extends React.ComponentPropsWithoutRef<typeof Checkbox> {
  label?: string
}

const SiteCorpCheckbox = React.forwardRef<
  React.ElementRef<typeof Checkbox>,
  SiteCorpCheckboxProps
>(({ label, className, ...props }, ref) => {
  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        ref={ref}
        className="border-sitecorp-primary data-[state=checked]:bg-sitecorp-primary data-[state=checked]:text-white"
        {...props}
      />
      {label && (
        <label className="text-sm font-medium text-ink leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          {label}
        </label>
      )}
    </div>
  )
})
SiteCorpCheckbox.displayName = "SiteCorpCheckbox"

export { SiteCorpCheckbox }