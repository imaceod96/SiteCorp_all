import { describe, it, expect } from "vitest"
import {
  PLATFORM_CATEGORY_ORDER,
  PLATFORM_PERMISSION_LABELS,
  groupPlatformPermissions,
} from "../domain/permissions.catalog"
import type { PlatformPermission } from "../domain/entities"
import { ENTITY_INTERNAL_MODULES, ENTITY_NAV } from "@/modules/organization-structure"
import { isEntityPermissionEnabledInPlan } from "@/modules/entity-plans"

describe("Acceso interno de plataforma a entidades y límite por plan", () => {
  it("expone los cuatro permisos de acceso interno de entidades en el catálogo de plataforma", () => {
    expect(PLATFORM_CATEGORY_ORDER).toContain("ENTIDADES (ACCESO INTERNO)")
    expect(PLATFORM_PERMISSION_LABELS["entity_settings.view"]).toBe(
      "Ver configuraciones internas de las entidades"
    )
    expect(PLATFORM_PERMISSION_LABELS["entity_settings.manage"]).toBe(
      "Gestionar configuraciones internas de las entidades"
    )
    expect(PLATFORM_PERMISSION_LABELS["entity_modules.view"]).toBe(
      "Ver módulos operativos dentro de las entidades (según plan)"
    )
    expect(PLATFORM_PERMISSION_LABELS["entity_modules.manage"]).toBe(
      "Gestionar módulos operativos dentro de las entidades (según plan)"
    )

    const sampleCatalog: PlatformPermission[] = [
      {
        id: "1",
        code: "organizations.view_all",
        description: null,
        category: "ORGANIZACIONES",
        is_platform_scope: true,
      },
      {
        id: "2",
        code: "entity_settings.view",
        description: null,
        category: "ENTIDADES (ACCESO INTERNO)",
        is_platform_scope: true,
      },
      {
        id: "3",
        code: "entity_modules.manage",
        description: null,
        category: "ENTIDADES (ACCESO INTERNO)",
        is_platform_scope: true,
      },
    ]

    const groups = groupPlatformPermissions(sampleCatalog)
    expect(groups.map((g) => g.title)).toEqual([
      "ORGANIZACIONES",
      "ENTIDADES (ACCESO INTERNO)",
    ])
    expect(groups[1].codes).toEqual(["entity_modules.manage", "entity_settings.view"])
  })

  it("exige permisos internos explícitos para mostrar Ajustes en la navegación de entidad", () => {
    const settingsModule = ENTITY_INTERNAL_MODULES.find((m) => m.key === "settings")
    expect(settingsModule).toBeDefined()
    expect(settingsModule?.permissions).toBeDefined()
    expect(settingsModule?.permissions?.length).toBeGreaterThan(0)
    expect(settingsModule?.permissions).toContain("organization.view")
    expect(settingsModule?.permissions).toContain("workers.initial_import")

    const settingsNav = ENTITY_NAV.find((entry) => entry.key === "settings")
    expect(settingsNav).toBeDefined()
    expect(settingsNav?.permissions).toEqual(settingsModule?.permissions)
  })

  it("limita los permisos internos asignables según los paquetes contratados del plan", () => {
    const basicPlan = { packagePrenomina: false, packageTrainingSst: false }
    expect(isEntityPermissionEnabledInPlan("workers.view", basicPlan)).toBe(true)
    expect(isEntityPermissionEnabledInPlan("organization.manage", basicPlan)).toBe(true)
    expect(isEntityPermissionEnabledInPlan("prenomina.view", basicPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("prenomina.manage", basicPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("training.view", basicPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("training.manage", basicPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("sst.view", basicPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("sst.manage", basicPlan)).toBe(false)

    const prenominaOnlyPlan = { packagePrenomina: true, packageTrainingSst: false }
    expect(isEntityPermissionEnabledInPlan("prenomina.view", prenominaOnlyPlan)).toBe(true)
    expect(isEntityPermissionEnabledInPlan("training.view", prenominaOnlyPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("sst.manage", prenominaOnlyPlan)).toBe(false)

    const trainingSstPlan = { packagePrenomina: false, packageTrainingSst: true }
    expect(isEntityPermissionEnabledInPlan("prenomina.manage", trainingSstPlan)).toBe(false)
    expect(isEntityPermissionEnabledInPlan("training.manage", trainingSstPlan)).toBe(true)
    expect(isEntityPermissionEnabledInPlan("sst.view", trainingSstPlan)).toBe(true)
  })
})
