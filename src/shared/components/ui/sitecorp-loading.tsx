import * as React from "react"
import { Skeleton } from "@/shared/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface SiteCorpLoadingProps {
  rows?: number
  className?: string
}

const SiteCorpLoading = React.forwardRef<
  HTMLDivElement,
  SiteCorpLoadingProps
>(({ rows = 3, className, ...props }, ref) => {
  return (
    <div ref={ref} className={cn("space-y-4", className)} {...props}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
})
SiteCorpLoading.displayName = "SiteCorpLoading"

export { SiteCorpLoading }