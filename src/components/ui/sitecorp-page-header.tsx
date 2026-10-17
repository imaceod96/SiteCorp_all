import * as React from "react"

import { Button } from "@/shared/components/ui/button"
import { cn } from "@/lib/utils"

interface SiteCorpPageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  description?: string
  actions?: React.ReactNode
}

const SiteCorpPageHeader = React.forwardRef<
  HTMLDivElement,
  SiteCorpPageHeaderProps
>(({ title, description, actions, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-4 md:flex-row md:items-center md:justify-between", className)}
      {...props}
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
})
SiteCorpPageHeader.displayName = "SiteCorpPageHeader"

export { SiteCorpPageHeader }