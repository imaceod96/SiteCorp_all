import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

/**
 * Configuración MÍNIMA de Vitest para pruebas unitarias del dominio.
 *
 * Decisiones (Bloque 6C.4B):
 *   · Entorno `node`: las pruebas son lógica pura (mapper y repositorio con
 *     Supabase mockeado). NO se usa DOM ni jsdom.
 *   · El alias `@` replica exactamente el de `vite.config.ts` para que las
 *     pruebas importen los mismos módulos que la aplicación.
 *   · No se cargan los plugins de la aplicación (react-swc, tagger): no hacen
 *     falta para probar lógica de dominio y evitan interferencias.
 *   · Sin cobertura, sin navegador, sin configuración adicional.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
})
