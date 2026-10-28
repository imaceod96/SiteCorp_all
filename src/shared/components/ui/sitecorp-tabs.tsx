import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Barra de pestañas de SiteCorp.
 *
 * Regla de layout (responsive real):
 *   · El contenedor NUNCA tiene altura fija: usa flex + flex-wrap y altura auto.
 *   · Cuando las pestañas no caben cómodamente en una fila, pasan a las filas
 *     necesarias y el fondo claro crece en altura automáticamente.
 *   · Ninguna pestaña queda fuera del marco ni se superpone con el contenido
 *     inferior.
 *
 * Mantiene la identidad visual existente: fondo suave (bg-muted), pestaña activa
 * con fondo claro (background) y texto destacado.
 */
const SiteCorpTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // h-auto + flex-wrap: el contenedor crece con el contenido (sin altura fija).
      "flex h-auto w-full flex-wrap items-center justify-start gap-1 rounded-md bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
SiteCorpTabsList.displayName = TabsPrimitive.List.displayName;

/**
 * Pestaña de SiteCorp. `flex-1` reparte proporcionalmente el ancho disponible en
 * pantalla ancha (una sola fila cuando cabe), mientras que `whitespace-nowrap` +
 * el ancho mínimo de contenido garantizan que el texto nunca se recorta ni se
 * cortan los nombres importantes.
 */
const SiteCorpTabTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
SiteCorpTabTrigger.displayName = TabsPrimitive.Trigger.displayName;

export { SiteCorpTabsList, SiteCorpTabTrigger };
