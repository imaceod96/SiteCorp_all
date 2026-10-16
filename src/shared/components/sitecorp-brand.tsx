import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Identidad visual oficial de SiteCorp.
 *
 * Los recursos viven en `public/brand` y esta es la ÚNICA implementación de la
 * marca: cualquier layout/pantalla debe reutilizarla en lugar de repetir el logo.
 *
 * Variante `full`: logotipo completo oficial A COLOR (isotipo + «SITECORP»).
 * Variante `isotype`: isotipo oficial a color para espacios reducidos.
 */
const SITECORP_BRAND = {
  /** Isotipo oficial a color (símbolo sin texto). Recurso principal en UI. */
  isotype: "/brand/isotipo-sitecorp.png",
  /** Logo completo oficial a color (isotipo + nombre). */
  full: "/brand/logo-sitecorp-full.png",
  /** Logo completo alternativo (SVG oficial monocromo), conservado para otros usos. */
  logoSvg: "/brand/logo-sitecorp.svg",
} as const

export type SiteCorpBrandVariant = "full" | "isotype"

// Alturas que conservan la proporción original (object-contain + width auto).
const VARIANT_HEIGHT: Record<SiteCorpBrandVariant, { sm: string; md: string; lg: string }> = {
  // El logo completo es horizontal (1400 × 788): con object-contain + width auto
  // conserva su proporción exacta. Alturas para una presencia clara sin dominar.
  full: { sm: "h-12", md: "h-16", lg: "h-28 sm:h-36" },
  isotype: { sm: "h-9", md: "h-10", lg: "h-16 sm:h-20" },
}

export interface SiteCorpBrandProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  variant?: SiteCorpBrandVariant
  size?: "sm" | "md" | "lg"
}

export function SiteCorpBrand({
  variant = "isotype",
  size = "sm",
  alt = "SiteCorp",
  className,
  ...props
}: SiteCorpBrandProps) {
  return (
    <img
      src={SITECORP_BRAND[variant]}
      alt={alt}
      draggable={false}
      className={cn("w-auto max-w-full object-contain select-none", VARIANT_HEIGHT[variant][size], className)}
      {...props}
    />
  )
}

export default SiteCorpBrand
