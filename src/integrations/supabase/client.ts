import { createClient } from "@supabase/supabase-js"
import { appConfig } from "@/shared/config/app-config"

export const supabase = createClient(appConfig.api.baseUrl, appConfig.api.publicKey)