import { useState, useCallback } from "react"
import { toast } from "sonner"

export function useToast() {
  const [toastId, setToastId] = useState<string | null>(null)

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = Math.random().toString(36).substr(2, 9)
    setToastId(id)
    
    switch (type) {
      case "success":
        toast.success(message, { id })
        break
      case "error":
        toast.error(message, { id })
        break
      default:
        toast.info(message, { id })
        break
    }
    
    return id
  }, [])

  const dismissToast = useCallback((id: string) => {
    // In a real implementation, we would dismiss the specific toast
    // For now, we'll just clear our state
    if (toastId === id) {
      setToastId(null)
    }
  }, [toastId])

  return { showToast, dismissToast }
}