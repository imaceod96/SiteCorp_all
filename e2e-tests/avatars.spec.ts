import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_SIGNED_URL_TTL_SECONDS,
  avatarFileError,
  avatarObjectPath,
  avatarPathFromStored,
  avatarSignedUrlNeedsRenewal,
} from "../src/domains/access-control/domain/account.rules"

/**
 * AVATAR PROPIO COMO OBJETO PRIVADO — reglas, contratos y frontera de Storage.
 *
 * El bucket de avatares es PRIVADO: `profiles.avatar_url` guarda la RUTA del objeto
 * (`<user_id>/<archivo>`), nunca una URL. La interfaz pinta una URL TEMPORAL (firmada) que se
 * renueva antes de caducar. Comprueba, con datos simulados y SIN subir ni borrar ningún archivo
 * real, lo que decide si la migración de avatares se mantiene:
 *   1. Ruta del objeto: saneado del nombre y carpeta del propio usuario.
 *   2. Lectura de lo guardado, incluido el formato anterior (URL pública o firmada).
 *   3. Renovación de la URL firmada antes de caducar.
 *   4. Validación previa del archivo (tipo y tamaño del bucket).
 *   5. Contratos de Storage y de la interfaz: firma temporal, sin URL pública, sin escritura
 *      directa desde la presentación.
 *
 * Distinción explícita de lo verificado:
 *   · PRUEBAS DE REGLAS → funciones puras ejecutadas de verdad.
 *   · PRUEBAS DE CONTRATOS → se lee el código y se comprueban bucket, rutas, firma y frontera.
 *   · PRUEBAS FUNCIONALES REALES → NINGUNA: no se inicia sesión y no se sube ni se borra ningún
 *     objeto. El flujo completo (subir → ver → reemplazar → borrar) se ejerce por la interfaz.
 */

const read = (path: string) => readFileSync(path, "utf8")

/** Código sin comentarios: lo que el módulo HACE, no lo que documenta. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")

const REPOSITORY = "src/domains/access-control/infrastructure/authentication.repository.ts"
const PROFILES = "src/domains/access-control/infrastructure/user-profiles.repository.ts"
const QUERIES = "src/domains/access-control/application/account.queries.ts"
const COMMANDS = "src/domains/access-control/application/authentication.commands.ts"

/* --------------------------------------------------------------------------- */
/* 1. La ruta vive dentro de la carpeta del propio usuario                     */
/* --------------------------------------------------------------------------- */

test("la ruta del avatar queda dentro de la carpeta del usuario que la sube", () => {
  expect(avatarObjectPath("user-1", "foto.png")).toBe("user-1/foto.png")

  // El nombre del archivo lo elige el usuario: no puede introducir separadores ni escapar con `../`.
  const escaped = avatarObjectPath("user-1", "../../otro.png")
  expect(escaped).toBe("user-1/_.._otro.png")
  expect(escaped.startsWith("user-1/")).toBe(true)
  expect(escaped.slice("user-1/".length)).not.toContain("/")

  // Un nombre inservible no deja la ruta vacía: sin nombre, el objeto se llama `avatar`.
  expect(avatarObjectPath("user-1", "  ")).toBe("user-1/avatar")
  expect(avatarObjectPath("user-1", "foto de perfil.png")).toBe("user-1/foto_de_perfil.png")
})

/* --------------------------------------------------------------------------- */
/* 2. Lo guardado es la RUTA (y el formato anterior se sigue resolviendo)      */
/* --------------------------------------------------------------------------- */

test("se guarda la ruta del objeto y un avatar anterior se sigue resolviendo", () => {
  expect(avatarPathFromStored(null)).toBeNull()
  expect(avatarPathFromStored(undefined)).toBeNull()
  expect(avatarPathFromStored("   ")).toBeNull()

  expect(avatarPathFromStored("user-1/foto.png")).toBe("user-1/foto.png")
  expect(avatarPathFromStored("/user-1/foto.png")).toBe("user-1/foto.png")

  // Formato anterior: URL pública o firmada del mismo bucket → se recupera su ruta, sin migrar datos.
  expect(
    avatarPathFromStored(
      "https://proyecto.supabase.co/storage/v1/object/public/avatars/user-1/foto.png"
    )
  ).toBe("user-1/foto.png")
  expect(
    avatarPathFromStored(
      "https://proyecto.supabase.co/storage/v1/object/sign/avatars/user-1/foto.png?token=abc"
    )
  ).toBe("user-1/foto.png")

  // Una URL de otro bucket o de otro dominio no se interpreta como avatar.
  expect(avatarPathFromStored("https://proyecto.supabase.co/storage/v1/object/public/documents/x.pdf"))
    .toBeNull()
  expect(avatarPathFromStored("https://otro.example.com/avatars/user-1/foto.png")).toBeNull()
})

/* --------------------------------------------------------------------------- */
/* 3. La URL firmada se renueva antes de caducar                              */
/* --------------------------------------------------------------------------- */

test("la URL firmada del avatar se renueva antes de caducar", () => {
  const issuedAt = 1_000_000
  const expiresAt = issuedAt + AVATAR_SIGNED_URL_TTL_SECONDS * 1000

  // Sin caducidad conocida (o sin URL) siempre se renueva.
  expect(avatarSignedUrlNeedsRenewal(0, issuedAt)).toBe(true)

  // Recién emitida: no se renueva. Cerca del 80 % de su vida útil: sí.
  expect(avatarSignedUrlNeedsRenewal(expiresAt, issuedAt)).toBe(false)
  expect(avatarSignedUrlNeedsRenewal(expiresAt, issuedAt + 60_000)).toBe(false)
  expect(avatarSignedUrlNeedsRenewal(expiresAt, expiresAt - 60_000)).toBe(true)
  expect(avatarSignedUrlNeedsRenewal(expiresAt, expiresAt)).toBe(true)
})

/* --------------------------------------------------------------------------- */
/* 4. Aviso previo del archivo elegido                                        */
/* --------------------------------------------------------------------------- */

test("el archivo se valida antes de subirlo, con el límite del bucket privado", () => {
  expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024)
  expect([...AVATAR_ALLOWED_MIME_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"])

  expect(avatarFileError({ type: "image/png", size: 1024 })).toBeNull()
  expect(avatarFileError({ type: "image/webp", size: AVATAR_MAX_BYTES })).toBeNull()

  expect(avatarFileError({ type: "image/gif", size: 1024 })).toBe(
    "La imagen debe ser PNG, JPG o WEBP."
  )
  expect(avatarFileError({ type: "image/jpeg", size: AVATAR_MAX_BYTES + 1 })).toBe(
    "La imagen no puede superar 2 MB."
  )
})

/* --------------------------------------------------------------------------- */
/* 5. Storage: bucket privado, firma temporal y sin URL pública                */
/* --------------------------------------------------------------------------- */

test("el avatar se firma al vuelo y nunca se sirve con una URL pública", () => {
  const repository = code(REPOSITORY)

  // Mismo bucket privado y misma ruta construida por la regla del dominio.
  expect(repository).toMatch(/AVATARS_BUCKET = "avatars"/)
  expect(repository).toMatch(/avatarObjectPath\(userId, file\.name\)/)
  expect(repository).toMatch(/\.from\(AVATARS_BUCKET\)/)

  // Subir devuelve la RUTA (no una URL) y el reemplazo no deja objetos huérfanos.
  expect(repository).toMatch(/export async function uploadOwnAvatar\(userId: string, file: File\): Promise<string>/)
  expect(repository).toMatch(/upsert: true/)

  // Ver: URL TEMPORAL firmada. Borrar: el objeto se retira del bucket.
  expect(repository).toMatch(/export async function createAvatarSignedUrl\(/)
  expect(repository).toMatch(/\.createSignedUrl\(path, expiresInSeconds\)/)
  expect(repository).toMatch(/export async function deleteAvatarObject\(path: string\)/)
  expect(repository).toMatch(/\.remove\(\[path\]\)/)

  // Ninguna URL pública: la imagen no se puede servir sin firma.
  expect(repository).not.toMatch(/getPublicUrl/)
  expect(repository).not.toMatch(/publicUrl/)

  // La consulta de aplicación firma la ruta guardada y descarta lo que no se puede firmar.
  const queries = code(QUERIES)
  expect(queries).toMatch(/export async function loadAvatarSignedUrl\(/)
  expect(queries).toMatch(/avatarPathFromStored\(storedAvatar\)/)
  expect(queries).toMatch(/if \(!path\) return null/)
  expect(queries).toMatch(/createAvatarSignedUrl\(path, expiresInSeconds\)/)

  // El perfil guarda SÓLO la ruta, en su operación dedicada.
  const profiles = code(PROFILES)
  expect(profiles).toMatch(/export async function updateUserProfileAvatar\(/)
  expect(profiles).toMatch(/\.update\(\{ avatar_url: avatarPath \}\)/)
  expect(profiles).not.toMatch(/avatarUrl/)
})

/* --------------------------------------------------------------------------- */
/* 6. Flujo de la cuenta: subir, reemplazar y borrar                          */
/* --------------------------------------------------------------------------- */

test("la cuenta propia sube, reemplaza y borra su avatar sin escribir URLs en el perfil", () => {
  const commands = code(COMMANDS)

  // Subir: guarda la ruta y retira el objeto ANTERIOR (reemplazo sin basura). La ruta se guarda
  // ANTES de retirar la anterior, y un fallo al retirarla no invalida el avatar nuevo.
  expect(commands).toMatch(/export async function updateOwnAvatar\(/)
  expect(commands).toMatch(/const avatarPath = await uploadOwnAvatar\(userId, file\)/)
  expect(commands).toMatch(/await updateUserProfileAvatar\(userId, avatarPath\)/)
  expect(commands).toMatch(/deleteAvatarObject\(previousPath\)\.catch\(\(\) => undefined\)/)
  // Borrar: se limpia la ruta del perfil ANTES de retirar el objeto.
  expect(commands).toMatch(/export async function removeOwnAvatar\(/)
  expect(commands).toMatch(/await updateUserProfileAvatar\(userId, null\)/)

  // La presentación pinta la URL firmada y no escribe `avatar_url` en el formulario.
  const account = code("src/pages/Account.tsx")
  expect(account).toMatch(/avatarUrl/)
  expect(account).toMatch(/avatarFileError\(/)
  expect(account).toMatch(/updateOwnAvatar\(/)
  expect(account).toMatch(/removeOwnAvatar\(/)
  expect(account).toMatch(/refreshAvatar\(/)
  expect(account).toMatch(/AvatarImage/)
  expect(account).not.toMatch(/avatar_url: formData/)

  // La sesión resuelve la URL firmada desde la ruta guardada y la renueva por su cuenta.
  const provider = code("src/contexts/AuthProvider.tsx")
  expect(provider).toMatch(/loadAvatarSignedUrl\(/)
  expect(provider).toMatch(/avatarSignedUrlNeedsRenewal\(/)
  expect(provider).toMatch(/avatarUrl,/)
  expect(provider).toMatch(/refreshAvatar,/)
  expect(code("src/contexts/AuthContext.ts")).toMatch(/avatarUrl: string \| null/)

  // El menú del usuario usa la misma URL firmada del contexto, no el valor guardado en el perfil.
  const menu = code("src/modules/access-control/presentation/components/sidebar-user-menu.tsx")
  expect(menu).toMatch(/avatarUrl, logout \} = useAuth\(\)/)
  expect(menu).toMatch(/<AvatarImage src=\{avatarUrl\}/)

  // Frontera: la presentación no habla con Storage ni con Supabase.
  for (const file of [
    "src/pages/Account.tsx",
    "src/modules/access-control/presentation/components/sidebar-user-menu.tsx",
    "src/contexts/AuthProvider.tsx",
  ]) {
    const source = code(file)
    expect(source, `${file} no debe usar Storage`).not.toMatch(/supabase\.storage/)
    expect(source, `${file} no debe crear URLs públicas`).not.toMatch(/getPublicUrl/)
  }
})
