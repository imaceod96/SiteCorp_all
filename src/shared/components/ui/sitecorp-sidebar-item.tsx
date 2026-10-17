import * as React from "react"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"

interface SiteCorpSidebarItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  icon: React.ReactNode
  label: string
  href: string
  isActive?: boolean
}

const SiteCorpSidebarItem = React.forwardRef<
  HTMLAnchorElement,
  SiteCorpSidebarItemProps
>(({ icon, label, href, isActive = false, className, ...props }, ref) => {
  const navigate = useNavigate()

  return (
    <a
      ref={ref}
      href={href}
      onClick={(e) => {
        e.preventDefault()
        navigate(href)
      }}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        isActive
          ? "bg-sitecorp-primary text-white"
          : "text-ink hover:bg-muted hover:text-ink",
        className
      )}
      {...props}
    >
      {icon}
      {label}
    </a>
  )
})
SiteCorpSidebarItem.displayName = "SiteCorpSidebarItem"

export { SiteCorpSidebarItem }