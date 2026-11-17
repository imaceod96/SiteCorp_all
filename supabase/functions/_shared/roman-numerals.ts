// Roman numeral conversion utilities for salary groups (shared between src/ and supabase/functions/)

/**
 * Convert an integer to a Roman numeral string
 * @param num - Integer to convert (1-3999)
 * @returns Roman numeral string
 */
export function toRomanNumeral(num: number): string {
  if (num < 1 || num > 3999) {
    throw new Error("Number must be between 1 and 3999")
  }

  const romanNumerals = [
    { value: 1000, symbol: "M" },
    { value: 900, symbol: "CM" },
    { value: 500, symbol: "D" },
    { value: 400, symbol: "CD" },
    { value: 100, symbol: "C" },
    { value: 90, symbol: "XC" },
    { value: 50, symbol: "L" },
    { value: 40, symbol: "XL" },
    { value: 10, symbol: "X" },
    { value: 9, symbol: "IX" },
    { value: 5, symbol: "V" },
    { value: 4, symbol: "IV" },
    { value: 1, symbol: "I" },
  ]

  let result = ""
  let remaining = num

  for (const { value, symbol } of romanNumerals) {
    while (remaining >= value) {
      result += symbol
      remaining -= value
    }
  }

  return result
}

/**
 * Convert a Roman numeral string to an integer
 * @param roman - Roman numeral string
 * @returns Integer value
 */
export function fromRomanNumeral(roman: string): number {
  const romanMap: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  }

  roman = roman.toUpperCase()
  let result = 0
  let prevValue = 0

  for (let i = roman.length - 1; i >= 0; i--) {
    const char = roman[i]
    const value = romanMap[char]

    if (!value) {
      throw new Error(`Invalid Roman numeral character: ${char}`)
    }

    if (value < prevValue) {
      result -= value
    } else {
      result += value
    }

    prevValue = value
  }

  return result
}

/**
 * Get the next Roman numeral after a given one
 * @param currentRoman - Current Roman numeral
 * @returns Next Roman numeral
 */
export function getNextRomanNumeral(currentRoman: string): string {
  const currentValue = fromRomanNumeral(currentRoman)
  return toRomanNumeral(currentValue + 1)
}

/**
 * Validate if a string is a valid Roman numeral
 * @param str - String to validate
 * @returns True if valid Roman numeral
 */
export function isValidRomanNumeral(str: string): boolean {
  try {
    fromRomanNumeral(str)
    return true
  } catch {
    return false
  }
}
