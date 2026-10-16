import { createContext, useContext, useEffect, useState } from "react"
import { User } from "@supabase/supabase-js"
import { supabase } from "@/integrations/supabase/client"

interface CurrentEntityContextType {
  currentEntity: string | null
  setCurrentEntity: (entity: string | null) => void
}

const CurrentEntityContext = createContext<CurrentEntityContextType | undefined>(undefined)

export function CurrentEntityProvider({ children }: { children: React.ReactNode }) {
  const [currentEntity, setCurrentEntity] = useState<string | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem("currentEntity")
    if (stored) {
      setCurrentEntity(stored)
    }
  }, [])

  return (
    <CurrentEntityContext.Provider value={{ currentEntity, setCurrentEntity }}>
      {children}
    </CurrentEntityContext.Provider>
  )
}

export function useCurrentEntity() {
  const context = useContext(CurrentEntityContext)
  if (context === undefined) {
    throw new Error("useCurrentEntity must be used within a CurrentEntityProvider")
  }
  return context
}