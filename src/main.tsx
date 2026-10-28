import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./globals.css";
import { initSchemaTarget } from "@/integrations/supabase/schema-target";

/**
 * El esquema físico (nomenclatura legacy o ya renombrada) se resuelve una única
 * vez ANTES de montar la interfaz, para que ninguna consulta pueda ejecutarse
 * contra el nombre equivocado. Si la detección no es concluyente se conserva el
 * estado actual de producción (legacy), de modo que la aplicación no se activa
 * por su cuenta contra el esquema nuevo.
 */
void initSchemaTarget().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
