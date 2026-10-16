export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: "admin" | "company-client" | "platform-user"
  tenant_id: string | null
  is_active: boolean
}

export interface Role {
  id: string
  name: string
  permissions: string[]
}

export interface Permission {
  id: string
  name: string
  description: string | null
}