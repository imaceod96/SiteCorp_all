import { createContext, useContext, useEffect, useState } from "react"
import { User } from "@supabase/supabase-js"
import { supabase } from "@/integrations/supabase/client"

interface CurrentCompanyClientContextType {
  currentCompanyClient: string | null
  setCurrentCompanyClient: (client: string | null) => void
}

const CurrentCompanyClientContext = createContext<CurrentCompanyClientContextType | undefined>(undefined)

export function CurrentCompanyClientProvider({ children }: { children: React.ReactNode }) {
  const [currentCompanyClient, setCurrentCompanyClient] = useState<string | null>(null)

  useEffect(() => {
    // Try to get from localStorage or sessionStorage
    const stored = localStorage.getItem("currentCompanyClient")
    if (stored) {
      setCurrentCompanyClient(stored)
    }
  }, [])

  return (
    <CurrentCompanyClientContext.Provider value={{ currentCompanyClient, setCurrentCompanyClient }}>
      {children}
    </CurrentCompanyClientContext.Provider>
  )
}

export function useCurrentCompanyClient() {
  const context = useContext(CurrentCompanyClientContext)
  if (context === undefined) {
    throw new Error("useCurrentCompanyClient must be used within a CurrentCompanyClientProvider")
  }
  return context
}