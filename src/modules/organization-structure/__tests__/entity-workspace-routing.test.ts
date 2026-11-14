import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearStoredActiveEntityId,
  readStoredActiveEntityId,
  writeStoredActiveEntityId,
} from "@/contexts/CurrentEntityContext"
import {
  contractAlertsPath,
  ENTITY_INTERNAL_MODULES,
  resolveLegacyEntityPath,
} from "@/modules/organization-structure/domain/entity-modules.catalog"

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

describe("entity workspace clean routing and session persistence", () => {
  const originalWindow = (globalThis as { window?: unknown }).window

  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = {
      sessionStorage: createMemoryStorage(),
    }
  })

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window
    } else {
      ;(globalThis as { window?: unknown }).window = originalWindow
    }
  })

  it("generates clean root-level routes without entity identifiers for all internal modules", () => {
    const summary = ENTITY_INTERNAL_MODULES.find((mod) => mod.key === "summary")
    expect(summary?.path()).toBe("/home")
    expect(summary?.path("ent-123")).toBe("/home")
    expect(contractAlertsPath("ent-123")).toBe("/contracts/alerts")

    for (const mod of ENTITY_INTERNAL_MODULES) {
      const resolved = mod.path("ent-123")
      expect(resolved.startsWith("/")).toBe(true)
      expect(resolved).not.toContain("/entity/")
      expect(resolved).not.toContain(":entityId")
      expect(resolved).not.toContain("ent-123")
    }
  })

  it("translates legacy /entity/:entityId/* subpaths to clean workspace paths", () => {
    expect(resolveLegacyEntityPath("")).toBe("/home")
    expect(resolveLegacyEntityPath("/")).toBe("/home")
    expect(resolveLegacyEntityPath("summary")).toBe("/home")
    expect(resolveLegacyEntityPath("panel")).toBe("/home")
    expect(resolveLegacyEntityPath("home")).toBe("/home")
    expect(resolveLegacyEntityPath("workers/123")).toBe("/workers/123")
    expect(resolveLegacyEntityPath("/settings/staffing/")).toBe("/settings/staffing")
  })

  it("persists and clears active entity session scoped by userId", () => {
    expect(readStoredActiveEntityId("user-1")).toBeNull()

    writeStoredActiveEntityId("user-1", "entity-42")
    expect(readStoredActiveEntityId("user-1")).toBe("entity-42")
    expect(readStoredActiveEntityId()).toBe("entity-42")
    expect(readStoredActiveEntityId("user-2")).toBeNull()

    clearStoredActiveEntityId()
    expect(readStoredActiveEntityId("user-1")).toBeNull()
  })

  it("ignores malformed sessionStorage payloads", () => {
    const win = (globalThis as { window: { sessionStorage: Storage } }).window
    win.sessionStorage.setItem("sitecorp.activeEntitySession.v1", "{invalid-json")
    expect(readStoredActiveEntityId("user-1")).toBeNull()

    win.sessionStorage.setItem("sitecorp.activeEntitySession.v1", JSON.stringify({ userId: "user-1" }))
    expect(readStoredActiveEntityId("user-1")).toBeNull()
  })
})
