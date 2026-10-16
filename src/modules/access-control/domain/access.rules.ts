// Access control rules
export const ACCESS_RULES = {
  PLATFORM_ADMIN: "platform:admin",
  COMPANY_CLIENT: "company-client",
  ENTITY_USER: "entity:user",
} as const

export type AccessRule = (typeof ACCESS_RULES)[keyof typeof ACCESS_RULES]