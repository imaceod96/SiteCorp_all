// Catálogo geográfico ÚNICO de Cuba (fuente de verdad; no duplicar en componentes).
//
// Estructura político-administrativa representada:
//   · 15 provincias con 167 municipios.
//   · 1 municipio especial: Isla de la Juventud.
//   · Total: 168 municipios.
//
// Nueva Gerona y Santa Fe son LOCALIDADES del municipio especial Isla de la Juventud:
// no se listan como municipios independientes.
//
// Nota de compatibilidad: los nombres corregidos (con tilde y denominación oficial)
// pueden diferir de valores ya guardados en Supabase. Los selectores conservan el valor
// persistido mediante `cubaProvinceOptions` / `cubaMunicipalityOptions`; este catálogo no
// normaliza ni modifica ningún registro existente.

export const CUBA_PROVINCES_FULL = [
  "Pinar del Río",
  "Artemisa",
  "La Habana",
  "Mayabeque",
  "Matanzas",
  "Cienfuegos",
  "Villa Clara",
  "Sancti Spíritus",
  "Ciego de Ávila",
  "Camagüey",
  "Las Tunas",
  "Holguín",
  "Granma",
  "Santiago de Cuba",
  "Guantánamo",
  "Isla de la Juventud",
]

export const MUNICIPIOS_BY_PROVINCE_FULL: Record<string, string[]> = {
  "Pinar del Río": [
    "Consolación del Sur",
    "Guane",
    "La Palma",
    "Los Palacios",
    "Mantua",
    "Minas de Matahambre",
    "Pinar del Río",
    "San Juan y Martínez",
    "San Luis",
    "Sandino",
    "Viñales",
  ],
  Artemisa: [
    "Alquízar",
    "Artemisa",
    "Bahía Honda",
    "Bauta",
    "Caimito",
    "Candelaria",
    "Guanajay",
    "Güira de Melena",
    "Mariel",
    "San Antonio de los Baños",
    "San Cristóbal",
  ],
  "La Habana": [
    "Arroyo Naranjo",
    "Boyeros",
    "Centro Habana",
    "Cerro",
    "Cotorro",
    "Diez de Octubre",
    "Guanabacoa",
    "Habana del Este",
    "Habana Vieja",
    "La Lisa",
    "Marianao",
    "Playa",
    "Plaza de la Revolución",
    "Regla",
    "San Miguel del Padrón",
  ],
  Mayabeque: [
    "Batabanó",
    "Bejucal",
    "Güines",
    "Jaruco",
    "Madruga",
    "Melena del Sur",
    "Nueva Paz",
    "Quivicán",
    "San José de las Lajas",
    "San Nicolás",
    "Santa Cruz del Norte",
  ],
  Matanzas: [
    "Calimete",
    "Cárdenas",
    "Ciénaga de Zapata",
    "Colón",
    "Jagüey Grande",
    "Jovellanos",
    "Limonar",
    "Los Arabos",
    "Martí",
    "Matanzas",
    "Pedro Betancourt",
    "Perico",
    "Unión de Reyes",
  ],
  Cienfuegos: [
    "Abreus",
    "Aguada de Pasajeros",
    "Cienfuegos",
    "Cruces",
    "Cumanayagua",
    "Lajas",
    "Palmira",
    "Rodas",
  ],
  "Villa Clara": [
    "Caibarién",
    "Camajuaní",
    "Cifuentes",
    "Corralillo",
    "Encrucijada",
    "Manicaragua",
    "Placetas",
    "Quemado de Güines",
    "Ranchuelo",
    "Remedios",
    "Sagua la Grande",
    "Santa Clara",
    "Santo Domingo",
  ],
  "Sancti Spíritus": [
    "Cabaiguán",
    "Fomento",
    "Jatibonico",
    "La Sierpe",
    "Sancti Spíritus",
    "Taguasco",
    "Trinidad",
    "Yaguajay",
  ],
  "Ciego de Ávila": [
    "Baraguá",
    "Bolivia",
    "Chambas",
    "Ciego de Ávila",
    "Ciro Redondo",
    "Florencia",
    "Majagua",
    "Morón",
    "Primero de Enero",
    "Venezuela",
  ],
  Camagüey: [
    "Camagüey",
    "Carlos Manuel de Céspedes",
    "Esmeralda",
    "Florida",
    "Guáimaro",
    "Jimaguayú",
    "Minas",
    "Najasa",
    "Nuevitas",
    "Santa Cruz del Sur",
    "Sibanicú",
    "Sierra de Cubitas",
    "Vertientes",
  ],
  "Las Tunas": [
    "Amancio",
    "Colombia",
    "Jesús Menéndez",
    "Jobabo",
    "Las Tunas",
    "Majibacoa",
    "Manatí",
    "Puerto Padre",
  ],
  Holguín: [
    "Antilla",
    "Báguanos",
    "Banes",
    "Cacocum",
    "Calixto García",
    "Cueto",
    "Frank País",
    "Gibara",
    "Holguín",
    "Mayarí",
    "Moa",
    "Rafael Freyre",
    "Sagua de Tánamo",
    "Urbano Noris",
  ],
  Granma: [
    "Bartolomé Masó",
    "Bayamo",
    "Buey Arriba",
    "Campechuela",
    "Cauto Cristo",
    "Guisa",
    "Jiguaní",
    "Manzanillo",
    "Media Luna",
    "Niquero",
    "Pilón",
    "Río Cauto",
    "Yara",
  ],
  "Santiago de Cuba": [
    "Contramaestre",
    "Guamá",
    "Mella",
    "Palma Soriano",
    "San Luis",
    "Santiago de Cuba",
    "Segundo Frente",
    "Songo-La Maya",
    "Tercer Frente",
  ],
  Guantánamo: [
    "Baracoa",
    "Caimanera",
    "El Salvador",
    "Guantánamo",
    "Imías",
    "Maisí",
    "Manuel Tames",
    "Niceto Pérez",
    "San Antonio del Sur",
    "Yateras",
  ],
  "Isla de la Juventud": ["Isla de la Juventud"],
}

/**
 * Municipios de una provincia tal como se ofrecen en los selectores.
 *
 * Si el valor ya guardado no forma parte del catálogo corregido (por ejemplo, un nombre
 * escrito sin tilde antes de esta corrección) se antepone a la lista: el selector muestra
 * y conserva el dato existente en lugar de quedar en blanco. No normaliza ni modifica
 * ningún valor persistido.
 */
export const cubaMunicipalityOptions = (
  province: string | null | undefined,
  persisted?: string | null
): string[] => {
  if (!province) return []
  const catalog = MUNICIPIOS_BY_PROVINCE_FULL[province] || []
  if (!persisted || catalog.includes(persisted)) return [...catalog]
  return [persisted, ...catalog]
}

/**
 * Provincias tal como se ofrecen en los selectores, con la misma garantía de
 * compatibilidad para valores ya guardados que `cubaMunicipalityOptions`.
 */
export const cubaProvinceOptions = (persisted?: string | null): string[] =>
  !persisted || CUBA_PROVINCES_FULL.includes(persisted)
    ? [...CUBA_PROVINCES_FULL]
    : [persisted, ...CUBA_PROVINCES_FULL]
