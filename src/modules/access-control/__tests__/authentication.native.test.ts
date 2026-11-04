import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  rpcMock,
  fromMock,
  functionsInvokeMock,
  authSignInMock,
  authGetSessionMock,
  authGetUserMock,
  authSignOutMock,
  authUpdateUserMock,
} = vi.hoisted(() => {
  const storageMap = new Map<string, string>()
  const localStorageMock: Storage = {
    get length() {
      return storageMap.size
    },
    clear() {
      storageMap.clear()
    },
    getItem(key: string) {
      return storageMap.has(key) ? storageMap.get(key)! : null
    },
    key(index: number) {
      return Array.from(storageMap.keys())[index] ?? null
    },
    removeItem(key: string) {
      storageMap.delete(key)
    },
    setItem(key: string, value: string) {
      storageMap.set(key, String(value))
    },
  }

  Object.defineProperty(globalThis, "window", {
    value: {
      localStorage: localStorageMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    writable: true,
    configurable: true,
  })

  return {
    rpcMock: vi.fn(),
    fromMock: vi.fn(),
    functionsInvokeMock: vi.fn(),
    authSignInMock: vi.fn(),
    authGetSessionMock: vi.fn(),
    authGetUserMock: vi.fn(),
    authSignOutMock: vi.fn(),
    authUpdateUserMock: vi.fn(),
  }
})

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    functions: {
      invoke: (...args: unknown[]) => functionsInvokeMock(...args),
    },
    auth: {
      signInWithPassword: (...args: unknown[]) => authSignInMock(...args),
      getSession: (...args: unknown[]) => authGetSessionMock(...args),
      getUser: (...args: unknown[]) => authGetUserMock(...args),
      signOut: (...args: unknown[]) => authSignOutMock(...args),
      updateUser: (...args: unknown[]) => authUpdateUserMock(...args),
    },
  },
}))

import { appConfig } from "@/shared/config/app-config"
import {
  buildCustomSessionHeaders,
  clearLocalSessionStorage,
  getCurrentAuthenticatedUser,
  getCurrentAuthenticatedUserId,
  getCustomJwtToken,
  getCustomSessionToken,
  getStoredSessionUserMetadata,
  rpcIsPlatformSuperAdmin,
  rpcIsPlatformUser,
  selectSessionUser,
  setCustomJwtToken,
  setCustomSessionToken,
  setStoredSessionUserMetadata,
  signInWithPassword,
  signOut,
  subscribeAuthStateChanges,
  updateOwnPassword,
} from "../infrastructure/authentication.repository"
import { selectOwnPasswordLifecycle } from "../infrastructure/password-lifecycle.repository"
import { selectUserProfileById } from "../infrastructure/user-profiles.repository"

describe("Autenticación nativa PostgreSQL (SiteCorp-Local)", () => {
  beforeEach(() => {
    clearLocalSessionStorage()
    window.localStorage.clear()
    rpcMock.mockReset()
    fromMock.mockReset()
    functionsInvokeMock.mockReset()
    authSignInMock.mockReset()
    authGetSessionMock.mockReset()
    authGetUserMock.mockReset()
    authSignOutMock.mockReset()
    authUpdateUserMock.mockReset()
  })

  it("1. Inicio de sesión con nombre de usuario sin llamar a supabase.auth.signInWithPassword", async () => {
    const futureIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString()
    rpcMock.mockResolvedValueOnce({
      data: {
        authenticated: true,
        user_id: "11111111-2222-3333-4444-555555555555",
        username: "admin",
        email: "admin@sitecorp.local",
        full_name: "Administrador General",
        avatar_url: null,
        is_active: true,
        must_change_password: false,
        is_platform_superadmin: true,
        is_platform_user: true,
        session_token: "token_nativo_admin_12345",
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
        expires_at: futureIso,
      },
      error: null,
    })

    const events: Array<{ event: string; userId: string | null }> = []
    const unsubscribe = subscribeAuthStateChanges((event, user) => {
      events.push({ event, userId: user?.id ?? null })
    })

    const errorMessage = await signInWithPassword("admin", "AdminSecret!2026")
    unsubscribe()

    expect(errorMessage).toBeNull()
    expect(rpcMock).toHaveBeenCalledWith(
      "authenticate_user_credentials",
      expect.objectContaining({
        p_identifier: "admin",
        p_password: "AdminSecret!2026",
      })
    )
    expect(authSignInMock).not.toHaveBeenCalled()

    const storedUserRaw = window.localStorage.getItem(`${appConfig.auth.sessionStorageKey}_user`)
    expect(storedUserRaw).toBeTruthy()
    expect(storedUserRaw).not.toContain("AdminSecret!2026")
    expect(storedUserRaw).not.toContain("$2a$")
    expect(storedUserRaw).not.toContain("$2b$")

    expect(getCustomSessionToken()).toBe("token_nativo_admin_12345")
    expect(getCustomJwtToken()).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig")
    const meta = getStoredSessionUserMetadata()
    expect(meta?.userId).toBe("11111111-2222-3333-4444-555555555555")
    expect(meta?.username).toBe("admin")
    expect(meta?.isPlatformSuperAdmin).toBe(true)
    expect(events).toEqual([
      { event: "SIGNED_IN", userId: "11111111-2222-3333-4444-555555555555" },
    ])
  })

  it("2. Inicio de sesión con correo electrónico", async () => {
    const futureIso = new Date(Date.now() + 8 * 3600 * 1000).toISOString()
    rpcMock.mockResolvedValueOnce({
      data: {
        authenticated: true,
        user_id: "22222222-3333-4444-5555-666666666666",
        username: "rrhh.operador",
        email: "rrhh@sitecorp.local",
        full_name: "Especialista RRHH",
        is_active: true,
        must_change_password: false,
        session_token: "token_nativo_rrhh_67890",
        access_token: null,
        expires_at: futureIso,
      },
      error: null,
    })

    const errorMessage = await signInWithPassword("rrhh@sitecorp.local", "RrhhSecret!2026")
    expect(errorMessage).toBeNull()
    expect(authSignInMock).not.toHaveBeenCalled()

    const meta = getStoredSessionUserMetadata()
    expect(meta?.email).toBe("rrhh@sitecorp.local")
    expect(meta?.userId).toBe("22222222-3333-4444-5555-666666666666")
  })

  it("3. Rechazo de contraseña incorrecta sin crear sesión local", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        authenticated: false,
        reason: "invalid_credentials",
        message: "Credenciales inválidas.",
      },
      error: null,
    })

    const errorMessage = await signInWithPassword("admin", "ClaveIncorrecta")
    expect(errorMessage).toBe("Credenciales inválidas.")
    expect(getCustomSessionToken()).toBeNull()
    expect(getStoredSessionUserMetadata()).toBeNull()
    expect(authSignInMock).not.toHaveBeenCalled()
  })

  it("4. Bloqueo temporal tras intentos fallidos consecutivos", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        authenticated: false,
        reason: "account_locked",
        message: "Cuenta bloqueada temporalmente por múltiples intentos fallidos.",
      },
      error: null,
    })

    const errorMessage = await signInWithPassword("admin", "Intento6")
    expect(errorMessage).toContain("bloqueada temporalmente")
    expect(getCustomSessionToken()).toBeNull()
  })

  it("5 y 6. Persistencia y restauración de sesión al recargar o reabrir la aplicación mediante validate_user_session", async () => {
    const futureIso = new Date(Date.now() + 4 * 3600 * 1000).toISOString()
    setCustomSessionToken("token_persistido_reload")

    rpcMock.mockResolvedValueOnce({
      data: {
        valid: true,
        user_id: "11111111-2222-3333-4444-555555555555",
        username: "admin",
        email: "admin@sitecorp.local",
        full_name: "Administrador General",
        avatar_url: null,
        is_active: true,
        must_change_password: false,
        is_platform_superadmin: true,
        is_platform_user: true,
        access_token: "jwt_firmado_local",
        expires_at: futureIso,
      },
      error: null,
    })

    const restoredUser = await selectSessionUser()
    expect(restoredUser?.id).toBe("11111111-2222-3333-4444-555555555555")
    expect(restoredUser?.email).toBe("admin@sitecorp.local")
    expect(rpcMock).toHaveBeenCalledWith("validate_user_session", {
      p_session_token: "token_persistido_reload",
    })
    expect(authGetSessionMock).not.toHaveBeenCalled()
  })

  it("7. Expiración o revocación de sesión limpia el almacenamiento local y emite SIGNED_OUT", async () => {
    setCustomSessionToken("token_revocado_servidor")

    rpcMock.mockResolvedValueOnce({
      data: {
        valid: false,
        reason: "expired_or_revoked",
      },
      error: null,
    })

    const events: string[] = []
    const unsubscribe = subscribeAuthStateChanges((event) => events.push(event))

    const user = await selectSessionUser()
    unsubscribe()

    expect(user).toBeNull()
    expect(getCustomSessionToken()).toBeNull()
    expect(getStoredSessionUserMetadata()).toBeNull()
    expect(events).toContain("SIGNED_OUT")
  })

  it("8. Cierre completo de sesión revoca el token en PostgreSQL y limpia localStorage", async () => {
    setCustomSessionToken("token_para_cerrar")
    rpcMock.mockResolvedValueOnce({ data: { revoked: true }, error: null })

    const events: string[] = []
    const unsubscribe = subscribeAuthStateChanges((event) => events.push(event))

    await signOut()
    unsubscribe()

    expect(rpcMock).toHaveBeenCalledWith("revoke_user_session", {
      p_session_token: "token_para_cerrar",
    })
    expect(getCustomSessionToken()).toBeNull()
    expect(getStoredSessionUserMetadata()).toBeNull()
    expect(events).toContain("SIGNED_OUT")
    expect(authSignOutMock).not.toHaveBeenCalled()
  })

  it("9. Identificación correcta de currentUserId para auditoría, expedientes y certificados médicos", async () => {
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString()
    setCustomSessionToken("token_activo_auditoria")
    setStoredSessionUserMetadata({
      userId: "99999999-8888-7777-6666-555555555555",
      username: "auditor",
      email: "auditor@sitecorp.local",
      fullName: "Auditor Interno",
      avatarUrl: null,
      isActive: true,
      mustChangePassword: false,
      expiresAt: futureIso,
    })

    const userId = await getCurrentAuthenticatedUserId()
    const user = await getCurrentAuthenticatedUser()

    expect(userId).toBe("99999999-8888-7777-6666-555555555555")
    expect(user?.id).toBe("99999999-8888-7777-6666-555555555555")
    expect(user?.email).toBe("auditor@sitecorp.local")
    expect(authGetUserMock).not.toHaveBeenCalled()
  })

  it("10 y 11. Consulta de perfil, avatar, permisos de plataforma y ciclo de contraseña usando sesión nativa", async () => {
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString()
    setCustomSessionToken("token_storage_rls")
    setCustomJwtToken("jwt_postgrest_rls")
    setStoredSessionUserMetadata({
      userId: "11111111-2222-3333-4444-555555555555",
      username: "admin",
      email: "admin@sitecorp.local",
      fullName: "Administrador General",
      avatarUrl: "11111111-2222-3333-4444-555555555555/avatar.png",
      isActive: true,
      mustChangePassword: false,
      isPlatformSuperAdmin: true,
      isPlatformUser: true,
      expiresAt: futureIso,
    })

    fromMock.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "11111111-2222-3333-4444-555555555555",
                  full_name: "Administrador General",
                  username: "admin",
                  avatar_url: "11111111-2222-3333-4444-555555555555/avatar.png",
                  is_active: true,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "user_password_lifecycle") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  user_id: "11111111-2222-3333-4444-555555555555",
                  must_change_password: false,
                  initial_password_generated_at: null,
                  password_changed_at: futureIso,
                  created_at: futureIso,
                  updated_at: futureIso,
                },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    rpcMock.mockResolvedValue({ data: true, error: null })

    const profile = await selectUserProfileById("11111111-2222-3333-4444-555555555555")
    expect(profile?.username).toBe("admin")
    expect(profile?.email).toBe("admin@sitecorp.local")
    expect(profile?.avatar_url).toBe("11111111-2222-3333-4444-555555555555/avatar.png")

    const lifecycle = await selectOwnPasswordLifecycle("11111111-2222-3333-4444-555555555555")
    expect(lifecycle).toEqual({ status: "record", mustChange: false })

    expect(await rpcIsPlatformSuperAdmin()).toBe(true)
    expect(await rpcIsPlatformUser()).toBe(true)
  })

  it("12, 13 y 14. Protección cruzada, cabeceras para Edge Functions y cambio de contraseña sin Supabase Auth", async () => {
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString()
    setCustomSessionToken("token_edge_fn_999")
    setStoredSessionUserMetadata({
      userId: "11111111-2222-3333-4444-555555555555",
      username: "admin",
      email: "admin@sitecorp.local",
      fullName: "Administrador General",
      avatarUrl: null,
      isActive: true,
      mustChangePassword: true,
      expiresAt: futureIso,
    })

    const headers = buildCustomSessionHeaders()
    expect(headers).toEqual({
      [appConfig.auth.sessionHeaderName]: "token_edge_fn_999",
    })

    // Protección frente a acceso cruzado: pedir el perfil de otro usuario cuando RLS lo bloquea devuelve null (no filtra datos del usuario actual)
    fromMock.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }))
    const otherUserProfile = await selectUserProfileById("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    expect(otherUserProfile).toBeNull()

    rpcMock.mockResolvedValueOnce({
      data: { success: true },
      error: null,
    })

    await updateOwnPassword("NuevaClaveSegura!2026")
    expect(rpcMock).toHaveBeenCalledWith("update_user_password_credentials", {
      p_user_id: "11111111-2222-3333-4444-555555555555",
      p_new_password: "NuevaClaveSegura!2026",
      p_session_token: "token_edge_fn_999",
    })
    expect(authUpdateUserMock).not.toHaveBeenCalled()
    expect(getStoredSessionUserMetadata()?.mustChangePassword).toBe(false)
  })
})
