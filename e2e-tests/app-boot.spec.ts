import { test, expect } from "@playwright/test";

/**
 * Arranque de la aplicación con la frontera de nomenclatura activa.
 *
 * `main.tsx` resuelve el esquema físico (legacy o ya renombrado) ANTES de montar la
 * interfaz. Este guion comprueba que ese paso no bloquea el arranque y que, sin
 * sesión, la aplicación llega a la pantalla de acceso. Es la cobertura de humo de la
 * adaptación Tenant → CompanyClient: si la frontera rompiera el arranque, aquí se ve.
 */
test("la aplicación arranca y muestra la pantalla de acceso", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByPlaceholder("tu@email.com")).toBeVisible();
  await expect(page.getByPlaceholder("••••••••")).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
});
