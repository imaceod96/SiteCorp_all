import * as React from "react"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/components/ui/card"
import { cn } from "@/lib/utils"

interface SiteCorpCardProps extends React.ComponentPropsWithoutRef<typeof Card> {
  title?: string
  description?: string
  children: React.ReactNode
}

const SiteCorpCard = React.forwardRef<
  HTMLDivElement,
  SiteCorpCardProps
>(({ title, description, children, className, ...props }, ref) => {
  return (
    <Card
      ref={ref}
      className={cn("border border-border bg-card shadow-sm", className)}
      {...props}
    >
      {(title || description) && (
        <CardHeader>
          {title && <CardTitle className="text-ink">{title}</CardTitle>}
          {description && (
            <CardDescription className="text-muted-foreground">
              {description}
            </CardDescription>
          )}
        </CardHeader>
      )}
      <CardContent>{children}</CardContent>
    </Card>
  )
})
SiteCorpCard.displayName = "SiteCorpCard"

export { SiteCorpCard }