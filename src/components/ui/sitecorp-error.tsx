import * as React from "react"
import { AlertCircle } from "lucide-react"
import { Button } from "@/shared/components/ui/button"
import { cn } from "@/lib/utils"

interface SiteCorpErrorProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  message?: string
  onRetry?: () => void
}

const SiteCorpError = React.forwardRef<
  HTMLDivElement,
  SiteCorpErrorProps
>(({ title = "Algo salió mal", message = "Ocurrió un error inesperado.", onRetry, className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center",
        "border-sitecorp-danger/20 bg-sitecorp-danger/5",
        className
      )}
      {...props}
    >
      <AlertCircle className="h-12 w-12 text-sitecorp-danger mb-4" />
      <h3 className="text-lg font-semibold text-ink mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4">{message}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
})
SiteCorpError.displayName = "SiteCorpError"

export { SiteCorpError }