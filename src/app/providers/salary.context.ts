import { createContext, useContext, useEffect, useState } from "react"

interface SalaryContextType {
  salaryData: any
  setSalaryData: (data: any) => void
}

const SalaryContext = createContext<SalaryContextType | undefined>(undefined)

export function SalaryProvider({ children }: { children: React.ReactNode }) {
  const [salaryData, setSalaryData] = useState<any>(null)

  return (
    <SalaryContext.Provider value={{ salaryData, setSalaryData }}>
      {children}
    </SalaryContext.Provider>
  )
}

export function useSalary() {
  const context = useContext(SalaryContext)
  if (context === undefined) {
    throw new Error("useSalary must be used within a SalaryProvider")
  }
  return context
}