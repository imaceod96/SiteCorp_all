import * as React from "react"

import { Alert, AlertDescription, AlertTitle } from "@/shared/components/ui/alert"
import { cn } from "@/lib/utils"

type AlertType = "success" | "warning" | "danger" | "info"

interface SiteCorpAlertProps extends React.ComponentPropsWithoutRef<typeof Alert> {
  type?: AlertType
  title?: string
}

const alertStyles: Record<AlertType, string> = {
  success: "bg-sitecorp-success/5 border-sitecorp-success/20",
  warning: "bg-sitecorp-warning/5 border-sitecorp-warning/20",
  danger: "bg-sitecorp-danger/5 border-sitecorp-danger/20",
  info: "bg-sitecorp-primary/5 border-sitecorp-primary/20",
}

const alertIconColors: Record<AlertType, string> = {
  success: "text-sitecorp-success",
  warning: "text-sitecorp-warning",
  danger: "text-sitecorp-danger",
  info: "text-sitecorp-primary",
}

const SiteCorpAlert = React.forwardRef<
  HTMLDivElement,
  SiteCorpAlertProps
>(({ type = "info", title, children, className, ...props }, ref) => {
  return (
    <Alert
      ref={ref}
      className={cn(alertStyles[type], className)}
      {...props}
    >
      {title && (
        <AlertTitle className={cn("text-ink", alertIconColors[type])}>
          {title}
        </AlertTitle>
      )}
      <AlertDescription className="text-foreground/80">
        {children}
      </AlertDescription>
    </Alert>
  )
})
SiteCorpAlert.displayName = "SiteCorpAlert"

export { SiteCorpAlert }