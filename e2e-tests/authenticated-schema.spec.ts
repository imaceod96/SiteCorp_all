import { test, expect } from "@playwright/test"

/**
 * Integración de la aplicación con el esquema físico migrado (Tenant → CompanyClient).
 *
 * Iniciar sesión obliga a la app a resolver el esquema físico y a conversar con las
 * tablas y RPC reales: `profiles`, las RPC `is_platform_superadmin` / `is_platform_user`,
 * `company_client_memberships` con su embed a `company_clients` y la RPC de permisos.
 *
 * Este guion comprueba que esa conversación no termina en error de esquema: un nombre
 * físico equivocado (tabla o columna inexistente) hace que PostgREST responda 400
 * (columna inexistente) o 404 (tabla inexistente), que es exactamente la firma del
 * fallo que dejó la jerarquía organizativa sin mostrar.
 */
test("el inicio de sesión llega a la aplicación sin errores de esquema", async ({ page }) => {
  const schemaFailures: string[] = []

  page.on("response", (response) => {
    const url = response.url()
    if (!url.includes("/rest/v1/")) return
    if (response.status() === 400 || response.status() === 404) {
      schemaFailures.push(`${response.status()} ${url}`)
    }
  })

  await page.goto("/")
  await expect(page).toHaveURL(/\/login$/)

  await page.getByPlaceholder("tu@email.com").fill(process.env.DYAD_TEST_USER_EMAIL ?? "")
  await page.getByPlaceholder("••••••••").fill(process.env.DYAD_TEST_USER_PASSWORD ?? "")
  await page.getByRole("button", { name: "Iniciar sesión" }).click()

  await expect(page).not.toHaveURL(/\/login$/)
  // Espera a que termine la carga de sesión: cuando desaparece, todas las consultas
  // de arranque (perfil, RPC de permisos, membresías con embed) ya han respondido.
  await expect(page.getByText("Cargando SiteCorp...")).toHaveCount(0)
  await expect(page.getByText("Error de la aplicación")).toHaveCount(0)
  expect(schemaFailures).toEqual([])
})
