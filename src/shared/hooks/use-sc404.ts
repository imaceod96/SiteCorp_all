import { useEffect, useState } from "react"
import { useLocation } from "react-router-dom"

export function useSc404() {
  const location = useLocation()
  const [sc404, setSc404] = useState(false)

  useEffect(() => {
    const checkSc404 = () => {
      // Simple heuristic: if the path doesn't match any known routes, it's a 404
      const knownPaths = ["/", "/login", "/organization", "/candidates", "/hiring"]
      const isKnown = knownPaths.some(path => location.pathname.startsWith(path))
      setSc404(!isKnown)
    }
    
    checkSc404()
  }, [location.pathname])

  return sc404
}