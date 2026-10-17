import * as React from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/components/ui/card"
import { cn } from "@/lib/utils"

interface SiteCorpFormSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}

const SiteCorpFormSection = React.forwardRef<
  HTMLDivElement,
  SiteCorpFormSectionProps
>(({ title, description, children, className, ...props }, ref) => {
  return (
    <Card ref={ref} className={cn("border border-border bg-card", className)} {...props}>
      <CardHeader>
        <CardTitle className="text-ink">{title}</CardTitle>
        {description && (
          <CardDescription>{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
})
SiteCorpFormSection.displayName = "SiteCorpFormSection"

export { SiteCorpFormSection }