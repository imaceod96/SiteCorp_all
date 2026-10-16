// Shared utilities for SiteCorp

export function cn(...inputs: any[]): string {
  // Simple cn function - in real project would use tailwind-merge
  return inputs.filter(Boolean).join(' ')
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR'
  }).format(value)
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-ES').format(date)
}