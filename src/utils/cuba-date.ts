/**
 * Utilidades de fecha con zona horaria de Cuba (America/Havana) y formato dd/mm/aaaa.
 */

export const CUBA_TIMEZONE = "America/Havana";

/**
 * Devuelve la fecha actual en zona horaria de Cuba (America/Havana) en formato ISO YYYY-MM-DD.
 */
export function todayIsoInCuba(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: CUBA_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback UTC-5
  }
  const cubaShifted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  return cubaShifted.toISOString().slice(0, 10);
}

/**
 * Formatea una fecha ISO (YYYY-MM-DD o timestamp ISO) a dd/mm/aaaa sin desfase de zona horaria.
 */
export function formatIsoDateToDisplay(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Convierte un número entero (1..25) a número romano para grupos salariales.
 */
export function toRomanNumeral(num: number | string | null | undefined): string {
  if (num === null || num === undefined || num === "") return "—";
  const str = String(num).trim();
  if (/^[IVXLCDM]+$/i.test(str)) return str.toUpperCase();
  const parsed = Number(str);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 50) return str;
  const map: Array<[number, string]> = [
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let remaining = parsed;
  let result = "";
  for (const [val, symbol] of map) {
    while (remaining >= val) {
      result += symbol;
      remaining -= val;
    }
  }
  return result;
}
