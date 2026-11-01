/**
 * Dominio del Manual de Usuario de SiteCorp.
 * 
 * Define la estructura completa de información, flujos operativos,
 * descripciones de interfaz, permisos asociados y modelos visuales
 * para la visualización en app y la exportación en PDF.
 */

export interface ManualSection {
  id: string
  title: string
  category: "arquitectura" | "global" | "operativa" | "sst_bienestar" | "configuracion"
  subtitle: string
  route?: string
  realImagePath?: string
  rolesAllowed: string[]
  permissionsRequired: string[]
  purpose: string
  description: string
  keyElements: {
    name: string
    description: string
  }[]
  workflows: {
    title: string
    steps: string[]
  }[]
  businessRules: string[]
  mockup: {
    headerTitle: string
    headerSubtitle: string
    badges: string[]
    kpis?: { label: string; value: string; trend?: string; color?: "default" | "success" | "warning" | "danger" }[]
    tabs?: string[]
    tableColumns?: string[]
    tableRows?: { [key: string]: string }[]
    actionButtons?: string[]
    notes?: string
  }
}

export const MANUAL_METADATA = {
  platformName: "SiteCorp ERP",
  moduleName: "Manual Oficial de Usuario",
  version: "2.4.0",
  editionDate: "Noviembre 2026",
  code: "MAN-SITECORP-2026-v2",
  author: "Dirección de Tecnología y Arquitectura de Procesos SiteCorp",
  audience: "Administradores de Plataforma, Gerentes de RRHH, Jefes de Operaciones, Analistas de Nómina, Supervisores de SST y Auditores",
  summary:
    "Guía integral de operación y referencia funcional del ecosistema SiteCorp. Detalla las interfaces maestras de administración corporativa, la operación multi-entidad, gestión del ciclo de vida laboral, preliquidación salarial, control de EPP/SST, vacaciones, alertas contractuales y gobernanza de accesos.",
}

export const ARCHITECTURE_OVERVIEW = {
  title: "Arquitectura Operativa y Modelo de Dos Niveles",
  description:
    "SiteCorp opera mediante un modelo de separación estricta de dos capas de responsabilidad: la Administración Global de Plataforma y la Gestión de Entidades Operativas (Tenants).",
  levels: [
    {
      level: "Nivel 1: Administración Global de Plataforma (/admin)",
      target: "Super Administradores y Operadores Centrales de SiteCorp",
      responsibilities: [
        "Aprovisionamiento y parametrización de Clientes Corporativos y Entidades.",
        "Asignación y control de Planes Comerciales (Base, Prenómina, Capacitación & SST).",
        "Gobernanza de la Bolsa Global de Candidatos y Banco de Talentos central.",
        "Auditoría centralizada de eventos, accesos y transacciones en tiempo real.",
        "Configuración de la Escala Salarial Presupuestada Corporativa.",
        "Gestión del repositorio de Documentos Rectores de Nivel Plataforma.",
      ],
    },
    {
      level: "Nivel 2: Gestión de Entidad Operativa (/entity/:entityId)",
      target: "Gerentes de RRHH, Jefes de Planta, Supervisores SST y Analistas de Nómina",
      responsibilities: [
        "Control diario de la plantilla orgánica y cobertura de puestos de trabajo.",
        "Expedientes de colaboradores, historial laboral y contrataciones.",
        "Monitoreo de vencimientos contractuales con alertas semaforizadas a 30 y 15 días.",
        "Cálculo de la Prenómina con integración de nocturnidad (CLA), antigüedad y subsidios.",
        "Gestión de Seguridad y Salud en el Trabajo: EPP, Incidentes, Exámenes Médicos e IPERC.",
        "Administración de vacaciones devengadas/gozadas y control de licencias médicas (CITT).",
        "Generación y firma digitalizada de contratos y constancias institucionales.",
      ],
    },
  ],
  securityModel: {
    description: "Matriz de Seguridad y Aislamiento de Datos",
    points: [
      "Row Level Security (RLS) activo en la base de datos PostgreSQL/Supabase.",
      "Aislamiento riguroso de información entre entidades para garantizar confidencialidad.",
      "Control de acceso basado en roles (RBAC) con permisos granulares (view/manage).",
      "Validación de planes activos: los módulos desactivados en el plan de la entidad no son accesibles por interfaz ni llamadas de API.",
    ],
  },
}

export interface SetupStep {
  stepNumber: number
  title: string
  shortName: string
  route: string
  realImagePath: string
  objective: string
  whyOrderMatters: string
  mandatoryPrerequisite: string
  keyElements: string[]
  validationRules: string[]
}

export const ENTITY_INITIAL_SETUP_FLOW = {
  title: "Secuencia Obligatoria: Configuración Inicial de una Entidad",
  subtitle: "Flujo técnico secuencial indispensable para el aprovisionamiento y arranque de nuevas entidades",
  description:
    "Para garantizar la integridad referencial del sistema y evitar inconsistencias normativas o bloqueos en la contratación, los Gestores de SiteCorp y Administradores de Entidad deben seguir rigurosamente esta secuencia de 5 fases. Alterar o saltarse este orden impedirá la correcta formalización de contratos y el cálculo de la nómina.",
  steps: [
    {
      stepNumber: 1,
      title: "Paso 1: Crear Escala Salarial",
      shortName: "1. Escala Salarial",
      route: "/entity/:entityId/settings/salary",
      realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.38.34_p._m._55a115c6.png",
      objective: "Definir los grupos salariales (I, II, III, ...) con sus tarifas monetarias oficiales en CUP y su vigencia legal.",
      whyOrderMatters:
        "PRERREQUISITO INELUDIBLE: Ningún cargo de la plantilla puede ser dado de alta sin tener vinculado un Grupo Escala activo. Por ende, la escala salarial debe preexistir antes de crear la estructura de cargos.",
      mandatoryPrerequisite: "Aprovisionamiento de la entidad en el catálogo de clientes.",
      keyElements: [
        "Identificación de Régimen: PRESUPUESTADA (aplica Escala Presupuestada General de SiteCorp) o EMPRESARIAL (permite crear escala local).",
        "Grupos salariales activos: Grupo I (4,130.00 CUP), Grupo II (23,345.00 CUP), Grupo III (699,999.00 CUP).",
        "Botones 'Ver escala' y 'Ver historial' para fiscalizar las fechas de entrada en vigencia.",
      ],
      validationRules: [
        "En entidades presupuestadas no se permite escala local; se hereda la corporativa central.",
        "Cada grupo requiere una secuencia numérica obligatoria y un importe positivo en moneda CUP.",
      ],
    },
    {
      stepNumber: 2,
      title: "Paso 2: Crear la Plantilla (Área, Cargo y Puesto)",
      shortName: "2. Plantilla (Área -> Cargo -> Puesto)",
      route: "/entity/:entityId/settings/staffing",
      realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.38.48_p._m._f83b52ea.png",
      objective: "Modelar el organigrama operativo de la entidad en su jerarquía estricta de 3 niveles: Áreas -> Cargos -> Puestos.",
      whyOrderMatters:
        "ESTRUCTURA OPERATIVA BASE: Las Áreas delimitan las gerencias; los Cargos representan las profesiones u oficios tipificados vinculados al grupo salarial del Paso 1; y los Puestos determinan las plazas presupuestadas (capacidad autorizada) a cubrir por los trabajadores.",
      mandatoryPrerequisite: "Paso 1 completado (escala salarial activa existente).",
      keyElements: [
        "Sub-pestaña Áreas: Registro de unidades organizativas (ej. Recursos Humanos RRHH, Dirección, Logística).",
        "Sub-pestaña Cargos: Denominación ocupacional, área de adscripción y enlace forzoso al Grupo Salarial del Paso 1.",
        "Sub-pestaña Puestos: Asignación de capacidad autorizada numérica (plazas totales) y categoría ocupacional.",
      ],
      validationRules: [
        "No se puede registrar un cargo sin asociarlo a un área activa.",
        "No se puede registrar un cargo sin asociarlo a un grupo salarial válido.",
        "No se puede habilitar un puesto sin su cargo base.",
      ],
    },
    {
      stepNumber: 3,
      title: "Paso 3: Crear los Datos Contractuales",
      shortName: "3. Datos Contractuales",
      route: "/entity/:entityId/settings/contract-data",
      realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.39.10_p._m._02f2a0d9.png",
      objective: "Consignar los datos legales e institucionales del empleador y de sus representantes acreditados para formalizar contratos.",
      whyOrderMatters:
        "SEGURIDAD Y RESPALDO LEGAL: Al momento de formalizar un contrato, SiteCorp genera un snapshot (instantánea inmutable) con estos datos. Si no se configuran, las cláusulas del contrato quedan en blanco o inválidas ante el Ministerio de Trabajo.",
      mandatoryPrerequisite: "Identificación de la razón social y código de entidad.",
      keyElements: [
        "Organismo rector institucional y Rama de actividad económica.",
        "Código de Centro de Trabajo / Código Laboral.",
        "Dirección postal completa, Municipio y Provincia oficial.",
        "Año de la Revolución para membretes y encabezados solemnes de ley.",
        "Representante Legal Autorizado: Nombre, CI, Cargo y Resolución oficial que lo faculta a firmar.",
      ],
      validationRules: [
        "Todos los campos contractuales son requeridos para la emisión válida de contratos laborales.",
      ],
    },
    {
      stepNumber: 4,
      title: "Paso 4: Crear la Escala de Antigüedad y Pagos Académicos",
      shortName: "4. Escala de Antigüedad",
      route: "/entity/:entityId/settings/tenure-scale",
      realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.39.21_p._m._48c2ac2f.png",
      objective: "Parametrizar las tablas de bonificación por años de servicio continuo y las sobretasas por posgrado (Máster y Doctorado).",
      whyOrderMatters:
        "AUTOMATIZACIÓN DE LA PRENÓMINA: Con esta escala guardada, el módulo de prenómina liquida automáticamente los devengados por antigüedad y superación profesional del colaborador desde su primer mes de contratación.",
      mandatoryPrerequisite: "Paso 1 completado.",
      keyElements: [
        "Tramos de años de antigüedad (rango desde-hasta en años y monto fijo en CUP).",
        "Retribución complementaria mensual por Grado de Máster o Especialidad (CUP).",
        "Retribución complementaria mensual por Grado Científico de Doctor (CUP).",
      ],
      validationRules: [
        "Los rangos de años de servicio deben ser continuos y no superpuestos.",
        "Los montos deben corresponder a la moneda oficial de la entidad.",
      ],
    },
    {
      stepNumber: 5,
      title: "Paso 5: Crear las Plantillas Documentales",
      shortName: "5. Plantillas Documentales",
      route: "/entity/:entityId/settings/document-templates",
      realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.39.32_p._m._b9e51b09.png",
      objective: "Subir y 버전ar los documentos oficiales en formato Word (.docx o .doc) con etiquetas dinámicas parametrizadas.",
      whyOrderMatters:
        "CIERRE DEL CIRCUITO DE PUESTA EN MARCHA: Integra todos los pasos previos (escala salarial, datos del puesto y datos contractuales) en las variables del contrato, dejando la entidad lista para contratar en 1 clic.",
      mandatoryPrerequisite: "Pasos 1, 2 y 3 concluidos.",
      keyElements: [
        "Plantillas por tipología de contrato: Indeterminado, Tiempo Determinado, Período de Prueba, Suplementos.",
        "Anexos normativos: Convenio de Confidencialidad y Compromiso de SST.",
        "Diccionario de variables dinámicas ({{trabajador_nombre}}, {{puesto}}, {{salario_basico}}, {{empresa_direccion}}, etc.).",
      ],
      validationRules: [
        "Solo se aceptan archivos válidos de Microsoft Word (.doc, .docx).",
        "Se debe verificar la correspondencia exacta de cada variable antes de activar la plantilla.",
      ],
    },
  ],
}

export const MANUAL_SECTIONS: ManualSection[] = [
  // --- VISTA 01: DASHBOARD PLATAFORMA ---
  {
    id: "admin-dashboard",
    category: "global",
    title: "Panel de Inicio y Métricas Globales",
    subtitle: "Consola de mando ejecutiva de la plataforma SiteCorp",
    route: "/admin",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.01.27_p._m._323e09e0.png",
    rolesAllowed: ["Super Administrador de Plataforma", "Administrador de Plataforma"],
    permissionsRequired: ["platform_users.view", "organizations.view_all"],
    purpose: "Supervisar el estado general del ecosistema, número de clientes registrados, clientes activos/inactivos y accesos rápidos.",
    description: "Pantalla principal de la Administración Global. Presenta las métricas maestras de clientes y botones de acceso directo a los módulos clave de la plataforma.",
    keyElements: [
      { name: "Tarjetas de Clientes (KPI)", description: "Total de clientes (Clientes registrados), Clientes activos (con badge verde Activo) y Clientes inactivos (badge ámbar Inactivo)." },
      { name: "Acciones Rápidas", description: "Botonera con accesos directos a Clientes (/admin/companies), Planes por entidad (/admin/plans), Usuarios de plataforma (/admin/users) y Roles y permisos (/admin/roles)." },
      { name: "Botón 'Ir a Clientes ->'", description: "Acceso primario directo al directorio del árbol organizativo." },
      { name: "Menú Lateral Oficial", description: "Barra lateral izquierda con Inicio, Clientes, Bolsa de Candidatos, Documentos, Historial, Gestión desplegable (Plan, Manual de Gestor), Ajustes y usuario activo." },
    ],
    workflows: [
      {
        title: "Revisión matutina de salud de plataforma",
        steps: [
          "Inicie sesión con credenciales de Administrador Global en la URL base.",
          "Verifique el contador de Clientes activos e inactivos en las tarjetas superiores.",
          "Utilice las 'Acciones rápidas' para navegar a Planes por entidad o Clientes según la tarea a realizar.",
        ],
      },
    ],
    businessRules: [
      "Solo los usuarios con rol de plataforma tienen visibilidad de esta vista.",
      "Los clientes activos son aquellos que cuentan con al menos una entidad en operación.",
    ],
    mockup: {
      headerTitle: "Administración Global",
      headerSubtitle: "Gestión de la plataforma SiteCorp",
      badges: ["Nivel Global", "Super Admin"],
      kpis: [
        { label: "Total de clientes", value: "1", trend: "Clientes registrados", color: "default" },
        { label: "Clientes activos", value: "1", trend: "Activo", color: "success" },
        { label: "Clientes inactivos", value: "0", trend: "Inactivo", color: "warning" },
      ],
      tableColumns: ["Módulo", "Ruta", "Estado"],
      tableRows: [
        { "Módulo": "Clientes", "Ruta": "/admin/companies", "Estado": "Disponible" },
        { "Módulo": "Planes por entidad", "Ruta": "/admin/plans", "Estado": "Disponible" },
        { "Módulo": "Usuarios de plataforma", "Ruta": "/admin/users", "Estado": "Disponible" },
      ],
      actionButtons: ["Ir a Clientes ->", "Planes por entidad"],
      notes: "Captura real tomada del sistema oficial SiteCorp Admin.",
    },
  },

  // --- VISTA 02: GESTIÓN DE CLIENTES Y ENTIDADES ---
  {
    id: "admin-companies",
    category: "global",
    title: "Gestión de Empresas Clientes y Entidades",
    subtitle: "Catálogo maestro de organizaciones, razones sociales y filiales",
    route: "/admin/companies",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.01.34_p._m._b2c4ec93.png",
    rolesAllowed: ["Super Administrador", "Gestor de Cuentas"],
    permissionsRequired: ["organizations.view_all", "organizations.manage_all"],
    purpose: "Administrar el árbol organizativo de clientes independientes con sus grupos empresariales, empresas y UEBs asociadas.",
    description: "Permite gestionar la estructura jerárquica de cada cliente (Tenant). Cada nodo puede tener o no su propia cuenta SiteCorp activa, permitiendo la gobernanza multi-entidad.",
    keyElements: [
      { name: "Tarjetas de Resumen Estructural", description: "Muestra Clientes (1), Entidades organizativas (5), Cuentas SiteCorp (3) y Cuentas activas (3)." },
      { name: "Buscador de Entidades", description: "Campo de búsqueda en tiempo real: 'Buscar cliente, grupo, empresa, UEB o código...'." },
      { name: "Botón '+ Crear cliente'", description: "Permite dar de alta un nuevo tenant independiente en el sistema." },
      { name: "Árbol Organizativo Jerárquico", description: "Despliega el nodo principal (ej. Tenant A con badge 'Cliente activo') y los nodos hijos anidados (ej. Grupo A con badges 'Grupo empresarial', 'PRESUPUESTADA', 'Cuenta SiteCorp' y 'Cuenta activa')." },
      { name: "Botonera de Acciones por Nodo", description: "Permite 'Editar', '+ Grupo', '+ Empresa', '-> Gestionar', 'Usuarios' y 'Eliminar' cada nivel organizativo." },
    ],
    workflows: [
      {
        title: "Aprovisionamiento de una entidad dentro de un grupo empresarial",
        steps: [
          "Localice el nodo padre en el 'Árbol organizativo' o mediante la barra de búsqueda.",
          "Haga clic en '+ Empresa' en el nodo correspondiente (ej. Grupo A).",
          "Complete el nombre, código interno y active el check 'Cuenta SiteCorp'.",
          "El nodo se creará en el árbol con sus badges verdes 'Cuenta SiteCorp' y 'Cuenta activa'.",
        ],
      },
    ],
    businessRules: [
      "La jerarquía del árbol permanece visible aunque un nodo específico no sea Cuenta SiteCorp.",
      "Solo los nodos con el badge 'Cuenta SiteCorp' tienen habilitada la asignación de planes comerciales y acceso a módulos internos.",
    ],
    mockup: {
      headerTitle: "Clientes",
      headerSubtitle: "Clientes independientes con grupos empresariales, empresas y UEB.",
      badges: ["Árbol Organizativo", "Multi-Tenant"],
      kpis: [
        { label: "Clientes", value: "1", color: "default" },
        { label: "Entidades organizativas", value: "5", color: "default" },
        { label: "Cuentas SiteCorp", value: "3", color: "default" },
        { label: "Cuentas activas", value: "3", color: "success" },
      ],
      tableColumns: ["Nodo Organizativo", "Tipo", "Condición", "Acciones Disponibles"],
      tableRows: [
        { "Nodo Organizativo": "Tenant A", "Tipo": "Cliente Principal", "Condición": "Cliente activo", "Acciones Disponibles": "Editar · + Grupo · Eliminar" },
        { "Nodo Organizativo": "Grupo A (Tenant A)", "Tipo": "Grupo empresarial", "Condición": "Cuenta SiteCorp · Cuenta activa", "Acciones Disponibles": "+ Empresa · Gestionar · Usuarios" },
      ],
      actionButtons: ["+ Crear cliente"],
      notes: "Captura real tomada del padrón maestro de Clientes en SiteCorp Admin.",
    },
  },

  // --- VISTA 03: GESTIÓN DE PLANES POR ENTIDAD ---
  {
    id: "admin-plans",
    category: "global",
    title: "Gestión de Planes por Entidad",
    subtitle: "Administración individual de paquetes y módulos habilitados por cuenta",
    route: "/admin/plans",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.01.41_p._m._e51291a5.png",
    rolesAllowed: ["Super Administrador de Plataforma"],
    permissionsRequired: ["entity_plans.view", "entity_plans.manage"],
    purpose: "Administrar individualmente qué paquetes y módulos de la plataforma SiteCorp tiene habilitados cada cuenta cliente.",
    description: "Módulo estratégico ubicado en la sección de 'Gestión'. Permite seleccionar entre las Cuentas SiteCorp existentes y encender o apagar paquetes comerciales.",
    keyElements: [
      { name: "Seleccionar Cuenta SiteCorp", description: "Bandeja de tarjetas con selector (Empresa A con checkmark, Grupo A, UEB A1) y buscador 'Buscar por nombre, código o cliente...'." },
      { name: "Panel 'Plan actual de la cuenta'", description: "Muestra la Entidad Seleccionada (Empresa A), Tenant asociado, ID único, badge 'Cuenta SiteCorp' y la 'Combinación activa' (ej. Básico + Prenómina + Capacitación y SST) con fecha de última modificación." },
      { name: "Paquete 1 — Básico", description: "Badge 'Obligatorio • Siempre activo' (switch bloqueado en encendido). Incluye Resumen, Personas, Contratación, Plantilla, Vacaciones y Licencias, y Ajustes de entidad." },
      { name: "Paquete 2 — Prenómina", description: "Badge 'Opcional' (switch interactivo). Incluye Incidencias del período, Cálculo salarial, Desglose por trabajador e Historiales de preliquidación." },
      { name: "Paquete 3 — Capacitación y SST", description: "Badge 'Opcional • Paquete' (switch interactivo). Incluye Plan Anual de Capacitación, EPP, Accidentes, EMO y Matriz IPERC." },
    ],
    workflows: [
      {
        title: "Modificación de paquetes contratados",
        steps: [
          "Seleccione la entidad en el mosaico 'Seleccionar Cuenta SiteCorp'.",
          "Revise en el panel izquierdo la 'Combinación activa' actual.",
          "En el panel derecho, active o desactive los switches de 'Paquete 2 — Prenómina' o 'Paquete 3 — Capacitación y SST'.",
          "Confirme el cambio en el diálogo modal ingresando el motivo de la modificación para auditoría.",
        ],
      },
    ],
    businessRules: [
      "El Paquete 1 (Básico) es obligatorio en SiteCorp y nunca se puede desactivar.",
      "Solo se muestran entidades con la condición estructural de Cuenta SiteCorp.",
      "Cualquier modificación actualiza inmediatamente la navegación de los usuarios de esa entidad.",
    ],
    mockup: {
      headerTitle: "Gestión de Planes por Entidad",
      headerSubtitle: "Administra individualmente qué paquetes y módulos tiene habilitados cada cuenta.",
      badges: ["Módulos Dinámicos", "Auditoría de Cambios"],
      kpis: [
        { label: "Paquete 1 Básico", value: "Activo", trend: "Obligatorio", color: "success" },
        { label: "Paquete 2 Prenómina", value: "Habilitado", trend: "Opcional", color: "success" },
        { label: "Paquete 3 SST", value: "Habilitado", trend: "Opcional", color: "success" },
      ],
      tableColumns: ["Paquete", "Condición", "Módulos que Habilita", "Estado Switch"],
      tableRows: [
        { "Paquete": "Paquete 1 — Básico", "Condición": "Obligatorio • Siempre activo", "Módulos que Habilita": "Resumen, Personas, Contratación, Plantilla, Vacaciones, Ajustes", "Estado Switch": "Activado (Bloqueado)" },
        { "Paquete": "Paquete 2 — Prenómina", "Condición": "Opcional", "Módulos que Habilita": "Incidencias, Cálculo salarial, Desglose, Historiales", "Estado Switch": "Activado" },
        { "Paquete": "Paquete 3 — Capacitación y SST", "Condición": "Opcional • Paquete", "Módulos que Habilita": "Cursos, Asistencias, EPP, Accidentes, EMO, IPERC", "Estado Switch": "Activado" },
      ],
      actionButtons: ["Guardar Configuración"],
      notes: "Captura real tomada del módulo oficial Gestión > Plan en SiteCorp Admin.",
    },
  },

  // --- VISTA 04: AUDITORÍA E HISTORIAL ---
  {
    id: "admin-history",
    category: "global",
    title: "Auditoría e Historial de Operaciones",
    subtitle: "Trazabilidad inmutable de cambios y acciones de los usuarios",
    route: "/admin/history",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.01.53_p._m._e7b42d32.png",
    rolesAllowed: ["Super Administrador", "Auditor de Cumplimiento"],
    permissionsRequired: ["platform_audit.view"],
    purpose: "Supervisar y auditar la trazabilidad de operaciones del sistema en tiempo real, registrando fecha, módulo, acción, ejecutor y ámbito.",
    description: "Módulo de cumplimiento y auditoría corporativa. Registra de forma inmutable cada mutación de datos (ej. guardado de plan por entidad, formalización de condiciones de trabajadores, cambios de roles).",
    keyElements: [
      { name: "Filtros de Búsqueda de Eventos", description: "Selectores por 'Año' (Todos / 2026), rangos de fecha 'Desde' y 'Hasta' (selectores tipo calendario dd/mm/aaaa) y 'Resultado' (Todos / Éxito / Error)." },
      { name: "Botones de Filtro", description: "Botones 'Limpiar' y 'Aplicar filtros' para ejecutar consultas focalizadas." },
      { name: "Tabla Maestra 'Eventos'", description: "Listado con columnas 'Fecha y hora', 'Módulo · acción', 'Ejecutor' y 'Ámbito'." },
      { name: "Detalle de Módulo y Acción", description: "Muestra el subsistema (ej. 'Sistema') y el identificador técnico de la operación (ej. 'save_entity_plan', 'worker_formalized_conditions') con la descripción de la ejecución." },
      { name: "Identificación del Ejecutor y Ámbito", description: "Especifica quién detonó la acción (ej. 'Administrador SiteCorp · admin') y sobre qué entidad operó (ej. 'Entidad Empresa A')." },
    ],
    workflows: [
      {
        title: "Auditoría de un cambio de plan comercial o formalización laboral",
        steps: [
          "Acceda a la ruta /admin/history desde el menú lateral 'Historial'.",
          "Ingrese el rango de fechas en los selectores 'Desde' y 'Hasta'.",
          "Presione 'Aplicar filtros'.",
          "Examine en la tabla el evento exacto, validando el ejecutor, la hora precisa y el ámbito afectado.",
        ],
      },
    ],
    businessRules: [
      "Los registros de eventos de auditoría son de solo lectura e inmutables (no pueden ser alterados ni eliminados por ningún usuario).",
      "Cada evento de guardado en la plataforma genera automáticamente una traza en esta tabla.",
    ],
    mockup: {
      headerTitle: "Historial de Operaciones",
      headerSubtitle: "Trazabilidad inmutable de cambios y acciones de los usuarios",
      badges: ["Auditoría Global", "Inmutable"],
      tableColumns: ["Fecha y hora", "Módulo · acción", "Ejecutor", "Ámbito"],
      tableRows: [
        { "Fecha y hora": "30/10/2026 15:36", "Módulo · acción": "Sistema save_entity_plan", "Ejecutor": "Administrador SiteCorp · admin", "Ámbito": "Entidad Empresa A" },
        { "Fecha y hora": "30/10/2026 15:29", "Módulo · acción": "Sistema worker_formalized_conditions", "Ejecutor": "Administrador SiteCorp · admin", "Ámbito": "Entidad Empresa A" },
        { "Fecha y hora": "30/10/2026 15:27", "Módulo · acción": "Sistema worker_formalized_conditions", "Ejecutor": "Administrador SiteCorp · admin", "Ámbito": "Entidad Empresa A" },
      ],
      actionButtons: ["Limpiar", "Aplicar filtros"],
      notes: "Captura real tomada del módulo oficial Historial en SiteCorp Admin.",
    },
  },

  // =========================================================================
  // SUBSECCIÓN: CONFIGURACIÓN INICIAL DE UNA ENTIDAD (5 PASOS OBLIGATORIOS)
  // Exclusivo para Gestores de Plataforma / Administradores de Entidad
  // =========================================================================

  // --- PASO 1 DE CONFIGURACIÓN INICIAL: ESCALA SALARIAL ---
  {
    id: "admin-setup-salary",
    category: "global",
    title: "Paso 1: Configuración de Escala Salarial",
    subtitle: "Prerrequisito 1: Grupos salariales, importes en CUP y vigencia legal",
    route: "/entity/:entityId/settings/salary",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.38.34_p._m._55a115c6.png",
    rolesAllowed: ["Super Administrador de Plataforma", "Gestor de Entidad", "Director de Finanzas"],
    permissionsRequired: ["salary.view", "salary.manage"],
    purpose: "Establecer la base retributiva de la entidad. Los cargos de la plantilla no pueden existir sin tener vinculado un grupo salarial válido.",
    description: "Muestra la condición de régimen de la entidad (Presupuestada vs Empresarial). Si es presupuestada, hereda la escala corporativa central. Si es empresarial, permite editar y fijar los grupos salariales con su correspondiente tarifa en CUP y fechas de entrada en vigencia.",
    keyElements: [
      { name: "Banner de Régimen", description: "Informa 'Régimen: PRESUPUESTADA. La escala aplicable es la Escala salarial presupuestada general de SiteCorp. No se permite crear escala local para entidades presupuestadas'." },
      { name: "Listado de Grupos Salariales", description: "Tarjetas de grupos activos con secuencia (Grupo I: 4,130.00 CUP, Grupo II: 23,345.00 CUP, Grupo III: 699,999.00 CUP) con badge verde 'Activo'." },
      { name: "Botonera de Inspección", description: "Botones 'Ver escala' y 'Ver historial' para fiscalizar las fechas de corte y trazabilidad de tarifas." },
    ],
    workflows: [
      {
        title: "Validación de escala salarial previa a la creación de cargos",
        steps: [
          "Navegue a Ajustes > Escala salarial de la entidad recién aprovisionada.",
          "Compruebe que figuren activos al menos los grupos salariales que empleará el personal.",
          "Verifique que cada grupo tenga configurado su importe mensual exacto en moneda CUP.",
          "Confirme el estado activo antes de pasar al Paso 2 (Creación de Plantilla).",
        ],
      },
    ],
    businessRules: [
      "Regla de prelación: Es obligatorio completar este paso antes de dar de alta cargos.",
      "En entidades presupuestadas, la escala es inmutable localmente para garantizar concordancia con el clasificador nacional.",
    ],
    mockup: {
      headerTitle: "Escala salarial — Entidad",
      headerSubtitle: "Gestión de la escala salarial de esta entidad",
      badges: ["Régimen: PRESUPUESTADA", "Moneda: CUP", "6 Grupos Activos"],
      kpis: [
        { label: "Grupo I", value: "4,130.00 CUP", trend: "Secuencia 1", color: "success" },
        { label: "Grupo II", value: "23,345.00 CUP", trend: "Secuencia 2", color: "success" },
        { label: "Grupo III", value: "699,999.00 CUP", trend: "Secuencia 3", color: "success" },
      ],
      tableColumns: ["Grupo", "Secuencia", "Tarifa Mensual", "Estado", "Vigencia"],
      tableRows: [
        { "Grupo": "Grupo I", "Secuencia": "1", "Tarifa Mensual": "4,130.00 CUP", "Estado": "Activo", "Vigencia": "2026-10-02" },
        { "Grupo": "Grupo II", "Secuencia": "2", "Tarifa Mensual": "23,345.00 CUP", "Estado": "Activo", "Vigencia": "2026-10-03" },
        { "Grupo": "Grupo III", "Secuencia": "3", "Tarifa Mensual": "699,999.00 CUP", "Estado": "Activo", "Vigencia": "2026-10-03" },
      ],
      actionButtons: ["Ver escala", "Ver historial"],
      notes: "Captura real tomada de Ajustes > Escala Salarial.",
    },
  },

  // --- PASO 2 DE CONFIGURACIÓN INICIAL: CONFIGURACIÓN DE PLANTILLA ---
  {
    id: "admin-setup-staffing",
    category: "global",
    title: "Paso 2: Configuración de Plantilla (Área, Cargo y Puesto)",
    subtitle: "Prerrequisito 2: Estructura organizativa interna en tres niveles jerárquicos",
    route: "/entity/:entityId/settings/staffing",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.38.48_p._m._f83b52ea.png",
    rolesAllowed: ["Super Administrador de Plataforma", "Jefe de Organización y Cuadros", "Gerente de RRHH"],
    permissionsRequired: ["staffing.view", "staffing.manage"],
    purpose: "Definir las áreas, cargos vinculados a la escala salarial y puestos autorizados con su capacidad numérica de plazas.",
    description: "Permite orquestar el organigrama operativo mediante tres pestañas: 1. Áreas (gerencias y departamentos), 2. Cargos (profesiones tipo vinculadas obligatoriamente a un grupo de la escala del Paso 1), y 3. Puestos (plazas autorizadas que se ofrecerán en contratación).",
    keyElements: [
      { name: "Pestañas Jerárquicas", description: "Navegación 'Áreas', 'Cargos' y 'Puestos' que reflejan la cadena de dependencia obligatoria." },
      { name: "Sub-vista Áreas", description: "Listado de departamentos (ej. Recursos Humanos RRHH, Dirección) con selector de estado y botón '+ Nueva área'." },
      { name: "Sub-vista Cargos", description: "Asignación del nombre del cargo, área a la que pertenece y vinculación forzosa con el Grupo Salarial (I, II, III...)." },
      { name: "Sub-vista Puestos", description: "Configuración de plazas nominales, capacidad numérica autorizada (plazas autorizadas) y categoría ocupacional." },
    ],
    workflows: [
      {
        title: "Creación secuencial de la estructura de plantilla",
        steps: [
          "Pestaña Áreas: Pulse '+ Nueva área' y registre las gerencias o departamentos funcionales.",
          "Pestaña Cargos: Pulse '+ Nuevo cargo', indique denominación, seleccione el área y asocie el Grupo de la Escala Salarial del Paso 1.",
          "Pestaña Puestos: Pulse '+ Nuevo puesto', vincúlelo al cargo creado y fije el número de plazas autorizadas (capacidad).",
        ],
      },
    ],
    businessRules: [
      "Sub-orden obligatorio: 1° Áreas -> 2° Cargos -> 3° Puestos.",
      "No se permite crear un cargo sin antes tener creado el grupo salarial en el Paso 1.",
      "Los puestos son los receptáculos indispensables para vincular a los trabajadores en contratación.",
    ],
    mockup: {
      headerTitle: "Configuración de plantilla",
      headerSubtitle: "Define la estructura organizativa y los puestos autorizados de esta entidad",
      badges: ["Jerarquía en 3 Niveles", "Áreas · Cargos · Puestos"],
      tabs: ["Áreas", "Cargos", "Puestos"],
      tableColumns: ["Nivel", "Entidad", "Código", "Dependencia", "Estado"],
      tableRows: [
        { "Nivel": "Área", "Entidad": "Recursos Humanos", "Código": "RRHH", "Dependencia": "Entidad Empresa A", "Estado": "Activa" },
        { "Nivel": "Cargo", "Entidad": "Especialista en RRHH", "Código": "CRG-001", "Dependencia": "Área RRHH · Grupo II (23,345 CUP)", "Estado": "Activo" },
        { "Nivel": "Puesto", "Entidad": "Esp. Selección y Altas", "Código": "PST-004", "Dependencia": "Capacidad: 2 plazas", "Estado": "Autorizado" },
      ],
      actionButtons: ["+ Nueva área", "+ Nuevo cargo", "+ Nuevo puesto", "Volver a ajustes"],
      notes: "Captura real tomada de Ajustes > Configuración de plantilla.",
    },
  },

  // --- PASO 3 DE CONFIGURACIÓN INICIAL: DATOS CONTRACTUALES ---
  {
    id: "admin-setup-contracts",
    category: "global",
    title: "Paso 3: Configuración de Datos Contractuales",
    subtitle: "Prerrequisito 3: Personería jurídica, domicilio legal y representante autorizado",
    route: "/entity/:entityId/settings/contract-data",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.39.10_p._m._02f2a0d9.png",
    rolesAllowed: ["Super Administrador", "Asesor Legal", "Director de Entidad"],
    permissionsRequired: ["contract_data.view", "contract_data.manage"],
    purpose: "Consignar los datos jurídicos e institucionales de la entidad empleadora que se plasmarán como snapshot legal en cada contrato formalizado.",
    description: "Formulario exhaustivo con los campos de personería jurídica que el motor de contratos utiliza para rellenar las cláusulas de cabecera y cierre en los modelos de contratación.",
    keyElements: [
      { name: "Organismo y Rama", description: "Ministerio u órgano de adscripción y rama de actividad económica." },
      { name: "Código de Centro de Trabajo", description: "Identificador oficial laboral o código de centro de costo de la entidad." },
      { name: "Domicilio Oficial", description: "Dirección institucional, Municipio y Provincia oficial." },
      { name: "Año de la Revolución", description: "Año histórico de rigor legal requerido para encabezados solemnes de documentos estatales." },
      { name: "Representante Legal Autorizado", description: "Nombre completo, carné de identidad, cargo y número de resolución ministerial o poder notarial que lo faculta a contratar." },
    ],
    workflows: [
      {
        title: "Carga de datos jurídicos para emisión de contratos",
        steps: [
          "Acceda a Ajustes > Datos contractuales.",
          "Complete el organismo rector, código de centro y dirección legal.",
          "Indique el Año de la Revolución correspondiente al ejercicio en curso.",
          "Asigne al representante legal firmante con su resolución habilitante.",
          "Guarde los cambios para habilitar la generación de documentos válidos.",
        ],
      },
    ],
    businessRules: [
      "Cualquier contrato formalizado almacena un snapshot inalterable con estos datos al momento de la firma.",
      "La ausencia de estos datos impide legalmente formalizar contratos en el módulo de Contratación.",
    ],
    mockup: {
      headerTitle: "Datos contractuales",
      headerSubtitle: "Datos contractuales de la entidad y representantes autorizados para la formalización",
      badges: ["Snapshot Jurídico", "Legalmente Vinculante"],
      tableColumns: ["Campo Institucional", "Valor Configurado", "Obligatoriedad"],
      tableRows: [
        { "Campo Institucional": "Organismo", "Valor Configurado": "Ministerio de la Industria", "Obligatoriedad": "Obligatorio" },
        { "Campo Institucional": "Código Centro Laboral", "Valor Configurado": "LAB-0921-A", "Obligatoriedad": "Obligatorio" },
        { "Campo Institucional": "Domicilio y Municipio", "Valor Configurado": "Calle Central #45, Plaza, La Habana", "Obligatoriedad": "Obligatorio" },
        { "Campo Institucional": "Representante Legal", "Valor Configurado": "Director General (Resolución 45/2025)", "Obligatoriedad": "Obligatorio" },
      ],
      actionButtons: ["Guardar datos contractuales", "Volver a ajustes"],
      notes: "Captura real tomada de Ajustes > Datos contractuales.",
    },
  },

  // --- PASO 4 DE CONFIGURACIÓN INICIAL: ESCALA DE ANTIGÜEDAD Y PAGOS ACADÉMICOS ---
  {
    id: "admin-setup-tenure",
    category: "global",
    title: "Paso 4: Escala de Antigüedad y Pagos Académicos",
    subtitle: "Prerrequisito 4: Tramos por años de servicio y compensaciones por posgrado",
    route: "/entity/:entityId/settings/tenure-scale",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.39.21_p._m._48c2ac2f.png",
    rolesAllowed: ["Super Administrador", "Analista de Compensaciones", "Jefe de Nómina"],
    permissionsRequired: ["tenure_scale.view", "tenure_scale.manage"],
    purpose: "Parametrizar las tablas de bonificación por años de servicio y los importes adicionales por titulación de Máster o Doctor.",
    description: "Configura los tramos de años acumulados de vida laboral y su correspondiente asignación económica en CUP, así como las sumas fijas reconocidas a trabajadores con títulos de posgrado. Alimenta de forma automática la Prenómina de la entidad.",
    keyElements: [
      { name: "Tramos de Antigüedad", description: "Tabla con rangos de años de servicio (desde - hasta) y monto mensual en CUP." },
      { name: "Pago por Máster / Especialidad", description: "Suma fija complementaria en CUP liquidada mensualmente por grado de maestría acreditado." },
      { name: "Pago por Doctorado Científico", description: "Suma complementaria en CUP liquidada mensualmente por grado de Doctor en Ciencias." },
    ],
    workflows: [
      {
        title: "Parametrización de pluses por experiencia y grado académico",
        steps: [
          "Acceda a Ajustes > Escala de pago de antigüedad.",
          "Defina los tramos escalonados de años trabajados y su retribución correspondiente.",
          "Establezca los valores reconocidos por título de Máster y Doctorado.",
          "Guarde los parámetros para que la Prenómina los asocie automáticamente al historial de cada colaborador.",
        ],
      },
    ],
    businessRules: [
      "Los tramos de años deben ser continuos para evitar vacíos en la liquidación.",
      "El cálculo en prenómina cruza la fecha de inicio laboral del colaborador con esta escala.",
    ],
    mockup: {
      headerTitle: "Escala de pago de antigüedad",
      headerSubtitle: "Configura los tramos de pago por antigüedad de esta entidad",
      badges: ["Tramos en CUP", "Pagos por Grado Científico"],
      tableColumns: ["Tramo / Concepto", "Rango de Años", "Importe Mensual", "Estado"],
      tableRows: [
        { "Tramo / Concepto": "Tramo Inicial", "Rango de Años": "2 a 4 años", "Importe Mensual": "250.00 CUP", "Estado": "Activo" },
        { "Tramo / Concepto": "Tramo Intermedio", "Rango de Años": "5 a 9 años", "Importe Mensual": "500.00 CUP", "Estado": "Activo" },
        { "Tramo / Concepto": "Tramo Avanzado", "Rango de Años": "10 o más años", "Importe Mensual": "900.00 CUP", "Estado": "Activo" },
        { "Tramo / Concepto": "Grado de Máster", "Rango de Años": "Acreditado", "Importe Mensual": "650.00 CUP", "Estado": "Activo" },
        { "Tramo / Concepto": "Grado de Doctor", "Rango de Años": "Acreditado", "Importe Mensual": "1,100.00 CUP", "Estado": "Activo" },
      ],
      actionButtons: ["+ Añadir tramo", "Guardar escala", "Volver a ajustes"],
      notes: "Captura real tomada de Ajustes > Escala de pago de antigüedad.",
    },
  },

  // --- PASO 5 DE CONFIGURACIÓN INICIAL: PLANTILLAS DOCUMENTALES ---
  {
    id: "admin-setup-templates",
    category: "global",
    title: "Paso 5: Plantillas Documentales de Contratos",
    subtitle: "Prerrequisito 5: Modelos Word (.docx) con variables dinámicas para generación formal",
    route: "/entity/:entityId/settings/document-templates",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.39.32_p._m._b9e51b09.png",
    rolesAllowed: ["Super Administrador", "Asesor Jurídico", "Especialista en Contratación"],
    permissionsRequired: ["document_templates.view", "document_templates.manage"],
    purpose: "Cargar y parametrizar los modelos Word oficiales de contratos laborales, suplementos y anexos con etiquetas dinámicas de sustitución.",
    description: "Cierre del ciclo de configuración inicial. Con la escala, la plantilla, los datos contractuales y los tramos ya establecidos, este módulo aloja los archivos .docx con variables mapeadas ({{trabajador_nombre}}, {{puesto}}, {{salario}}, etc.), permitiendo emitir contratos en 1 clic.",
    keyElements: [
      { name: "Listado de Plantillas Activas", description: "Modelos para Contrato Indeterminado, Contrato Determinado, Suplementos Salariales y Anexos de SST." },
      { name: "Control de Versiones y Archivo", description: "Permite subir nuevas versiones de archivos .doc o .docx manteniendo el histórico." },
      { name: "Diccionario de Variables Dinámicas", description: "Listado de etiquetas homologadas que el sistema sustituye automáticamente con la ficha del trabajador y los datos de la entidad." },
    ],
    workflows: [
      {
        title: "Carga y activación de una plantilla contractual oficial",
        steps: [
          "Acceda a Ajustes > Plantillas documentales.",
          "Seleccione el tipo de contrato (ej. Contrato por tiempo determinado).",
          "Suba el archivo Word (.docx) redactado con las variables normalizadas de SiteCorp.",
          "Verifique la correspondencia de las etiquetas dinámicas.",
          "Active la plantilla. La entidad queda lista para contratar colaboradores formalmente.",
        ],
      },
    ],
    businessRules: [
      "Cada tipo contractual requiere al menos una versión activa para formalizar en Contratación.",
      "Las plantillas respetan la tipografía, sellos y formato oficial del archivo Word cargado.",
    ],
    mockup: {
      headerTitle: "Plantillas documentales",
      headerSubtitle: "Gestiona las plantillas Word (.doc y .docx) de los contratos y anexos de esta entidad",
      badges: ["Modelos .docx", "Variables Dinámicas"],
      tableColumns: ["Tipo de Documento", "Nombre del Archivo", "Versión", "Variables Usadas", "Estado"],
      tableRows: [
        { "Tipo de Documento": "Contrato Indeterminado", "Nombre del Archivo": "Contrato_Indeterminado_v2.docx", "Versión": "v2.1", "Variables Usadas": "18 variables", "Estado": "Activa" },
        { "Tipo de Documento": "Contrato Determinado", "Nombre del Archivo": "Contrato_Determinado_v1.docx", "Versión": "v1.4", "Variables Usadas": "20 variables", "Estado": "Activa" },
        { "Tipo de Documento": "Suplemento Modificativo", "Nombre del Archivo": "Suplemento_Condiciones_v1.docx", "Versión": "v1.0", "Variables Usadas": "12 variables", "Estado": "Activa" },
      ],
      actionButtons: ["+ Subir plantilla", "Ver variables", "Volver a ajustes"],
      notes: "Captura real tomada de Ajustes > Plantillas documentales.",
    },
  },

  // =========================================================================
  // SECCIÓN II: MANUAL DE ENTIDADES OPERATIVAS (8 VISTAS CON CAPTURAS REALES)
  // =========================================================================

  // --- VISTA 05: RESUMEN DE ENTIDAD ---
  {
    id: "entity-summary",
    category: "operativa",
    title: "Resumen de la Entidad",
    subtitle: "Dashboard operativo: dotación activa, alertas contractuales y cumplimiento de SST",
    route: "/entity/:entityId/summary",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.14.29_p._m._8e34a04b.png",
    rolesAllowed: ["Administrador de Entidad", "Jefe de RRHH", "Supervisor de Operaciones"],
    permissionsRequired: ["organization.view", "workers.view"],
    purpose: "Proporcionar una visión integral en tiempo real de la plantilla, puestos ocupados, vacantes, contratos por vencer y avisos normativos de SST.",
    description: "Pantalla principal al ingresar a una entidad operativa (ej. Empresa A). Permite alternar entre el ámbito 'Esta entidad' o 'Entidad + descendientes', e intercambiar entre 'Vista general' y 'Reportes'. Incluye alertas de capacitación inicial y avisos de SST pendientes por nuevas contrataciones.",
    keyElements: [
      { name: "Selector de Ámbito y Vistas", description: "Opciones 'Esta entidad' / 'Entidad + descendientes' y pestañas 'Vista general' / 'Reportes'." },
      { name: "Banners de Avisos Normativos", description: "Alerta de 'Capacitación inicial pendiente por nuevas contrataciones' y 'Avisos de SST pendientes por contratación o cambio de cargo' con acceso directo a 'Gestionar en ficha ->'." },
      { name: "Cuadrícula de Indicadores Maestros", description: "10 Trabajadores activos, 34 Plazas autorizadas, 10 Puestos ocupados y 24 Vacantes." },
      { name: "Panel 'Contratos próximos a vencer'", description: "Muestra 2 contratos que requieren atención (< 15 días: 1, < 30 días: 1) con enlace a la consola completa de vencimientos." },
      { name: "Panel 'Cumplimiento de SST'", description: "0 / 10 Trabajadores al día en SST y 0 Sesiones programadas en el mes con enlaces rápidos a SST y Capacitación." },
      { name: "Desglose por Área y Género", description: "Dotación en Almacenes (6 ocupados, 11 vacantes), Dirección (4 ocupados, 13 vacantes) y gráfico de distribución por sexo (Hombres: 9, Mujeres: 1)." },
    ],
    workflows: [
      {
        title: "Monitoreo matutino de la dotación y avisos normativos",
        steps: [
          "Ingrese a la pantalla /entity/:id/summary para revisar los indicadores maestros.",
          "Verifique si existen banners amarillos de 'Avisos de SST pendientes' para nuevas contrataciones.",
          "Compruebe si el contador de 'Contratos próximos a vencer' tiene casos urgentes (< 15 días).",
          "Haga clic en 'Ver todos los contratos que vencen ->' para tramitar adendas inmediatas.",
        ],
      },
    ],
    businessRules: [
      "Disponible para todos los perfiles de la entidad (con filtros por ámbito local o descendientes).",
      "Los indicadores se recalculan dinámicamente con cada alta, baja o asignación en plantilla.",
    ],
    mockup: {
      headerTitle: "Resumen — Empresa A",
      headerSubtitle: "Dashboard operativo de dotación, contratos y SST",
      badges: ["Esta entidad", "Vista general"],
      kpis: [
        { label: "Trabajadores activos", value: "10", color: "default" },
        { label: "Plazas autorizadas", value: "34", color: "default" },
        { label: "Puestos ocupados", value: "10", color: "success" },
        { label: "Vacantes", value: "24", color: "warning" },
      ],
      tableColumns: ["Indicador Operativo", "Valor Registrado", "Estado / Condición", "Enlace de Gestión"],
      tableRows: [
        { "Indicador Operativo": "Contratos por vencer", "Valor Registrado": "2 contratos", "Estado / Condición": "<15d: 1 · <30d: 1", "Enlace de Gestión": "Ver todos los contratos que vencen ->" },
        { "Indicador Operativo": "Cumplimiento SST", "Valor Registrado": "0 / 10 al día", "Estado / Condición": "10 pendientes de instrucción", "Enlace de Gestión": "Ver módulo SST ->" },
        { "Indicador Operativo": "Capacitación Mensual", "Valor Registrado": "0 sesiones", "Estado / Condición": "Sin sesiones programadas", "Enlace de Gestión": "Ver capacitaciones ->" },
      ],
      actionButtons: ["Gestionar en ficha ->", "Ver todos los contratos"],
      notes: "Captura real tomada del módulo oficial Resumen en SiteCorp Entidad.",
    },
  },

  // --- VISTA 06: PLANTILLA ORGÁNICA ---
  {
    id: "entity-staffing",
    category: "operativa",
    title: "Plantilla Orgánica y Puestos",
    subtitle: "Estructura organizativa: Área -> Cargo/Puesto -> capacidad autorizada, ocupación y vacantes (Anexo14B)",
    route: "/entity/:entityId/staffing",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.14.35_p._m._c1ae7088.png",
    rolesAllowed: ["Administrador de Entidad", "Jefe de RRHH", "Especialista en Organización"],
    permissionsRequired: ["staffing.view", "staffing.manage"],
    purpose: "Gestionar la plantilla de personal autorizada, controlando capacidades por puesto y vacantes conforme al formato oficial Anexo14B.",
    description: "Representa la estructura formal de puestos por área organizativa (ej. DIRECCION). Cada fila es una capacidad del puesto; las capacidades sin trabajador aparecen explícitamente con el badge naranja «VACANTE».",
    keyElements: [
      { name: "Acciones de Cabecera", description: "Botones 'Exportar Anexo14B' (descarga del formato oficial institucional), 'Migrar trabajador' y '+ Nuevo trabajador'." },
      { name: "Tarjetas de Dotación", description: "10 Trabajadores activos, 34 Plazas autorizadas, 10 Ocupados y 24 Vacantes." },
      { name: "Botonera de Configuración y Filtros", description: "Botón 'Configurar estructura' y filtro dinámico 'Añadir filtro (34 de 34)'." },
      { name: "Agrupación por Área Organizativa", description: "Bloque desplegable (ej. DIRECCION) con totales de área: 'Autorizados: 1 | Ocupados: 1 | Vacantes: 0'." },
      { name: "Columnas del Anexo14B", description: "Cargo / Puesto, Categoría ocupacional, Trabajador (o «VACANTE»), Sexo, Carnet de identidad, Nivel de preparación, Grupo Escala y Salario (ej. 4,500.00 CUP)." },
    ],
    workflows: [
      {
        title: "Exportación del informe oficial Anexo14B",
        steps: [
          "Navegue a /entity/:id/staffing desde el menú lateral 'Plantilla'.",
          "Presione el botón 'Exportar Anexo14B' en la esquina superior derecha.",
          "El sistema compila la estructura de cargos, capacidades autorizadas y ocupantes actuales en el formato normativo.",
        ],
      },
    ],
    businessRules: [
      "Cada puesto tiene capacidades individuales numeradas.",
      "Las capacidades sin trabajador asignado se rotulan como «VACANTE» y quedan disponibles para contratación.",
    ],
    mockup: {
      headerTitle: "Plantilla",
      headerSubtitle: "Estructura organizativa: Área -> Cargo/Puesto -> capacidad autorizada, ocupación y vacantes",
      badges: ["Anexo14B", "34 de 34 plazas"],
      kpis: [
        { label: "Trabajadores activos", value: "10", color: "default" },
        { label: "Plazas autorizadas", value: "34", color: "default" },
        { label: "Ocupados", value: "10", color: "success" },
        { label: "Vacantes", value: "24", color: "warning" },
      ],
      tableColumns: ["Cargo / Puesto", "Categoría Ocupacional", "Trabajador", "CI", "Grupo Escala", "Salario"],
      tableRows: [
        { "Cargo / Puesto": "Director", "Categoría Ocupacional": "Administrativo", "Trabajador": "isael maceo diaz", "CI": "96062506741", "Grupo Escala": "II", "Salario": "4,500.00 CUP" },
        { "Cargo / Puesto": "PL Prueba B (Direccion)", "Categoría Ocupacional": "Administrativo", "Trabajador": "VACANTE", "CI": "—", "Grupo Escala": "II", "Salario": "3,800.00 CUP" },
      ],
      actionButtons: ["Exportar Anexo14B", "Migrar trabajador", "+ Nuevo trabajador", "Configurar estructura"],
      notes: "Captura real tomada del módulo oficial Plantilla en SiteCorp Entidad.",
    },
  },

  // --- VISTA 07: PADRÓN DE TRABAJADORES ---
  {
    id: "entity-workers",
    category: "operativa",
    title: "Padrón de Trabajadores",
    subtitle: "Directorio del personal que pertenece a la entidad (independiente de Plantilla y Puesto)",
    route: "/entity/:entityId/workers",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.14.47_p._m._aa5d34e5.png",
    rolesAllowed: ["Jefe de RRHH", "Analista de Personal", "Supervisor de Entidad"],
    permissionsRequired: ["workers.view", "workers.manage"],
    purpose: "Consultar y gestionar la lista integral de colaboradores registrados en la entidad con su estado de vinculación y completitud de ficha.",
    description: "Muestra la lista de personas registradas en la entidad con su código identificador interno, carnet de identidad, teléfono, correo y distintivos que indican si están vinculados a la plantilla y si su expediente laboral está completo o tiene campos pendientes.",
    keyElements: [
      { name: "Buscador General", description: "Búsqueda en tiempo real por 'nombre, carné de identidad o código...'." },
      { name: "Filtros y Contador", description: "Botón 'Añadir filtro' y contador '10 de 10'." },
      { name: "Tarjetas de Trabajador", description: "Nombre completo, código TRB (ej. TRB-BEFE49, TRB-000002, TRB-1470B4, TRB-EACFE6), CI y datos de contacto." },
      { name: "Badges de Estado de Plantilla", description: "Distintivo 'Vinculado a plantilla' que acredita la asignación activa a un puesto." },
      { name: "Badges de Completitud de Ficha", description: "Distintivo verde 'Ficha completa' o distintivo ámbar de alerta 'Ficha incompleta (1)' o 'Ficha incompleta (2)' para subsanación inmediata de datos." },
    ],
    workflows: [
      {
        title: "Búsqueda y regularización de ficha incompleta",
        steps: [
          "Escriba el nombre, CI o código en el buscador superior.",
          "Identifique los colaboradores marcados con el badge ámbar 'Ficha incompleta (X)'.",
          "Haga clic en la tarjeta del trabajador para abrir su expediente.",
          "Complete los campos faltantes (datos de contacto, seguridad social, bancarios) y guarde.",
          "El badge cambiará automáticamente a verde 'Ficha completa'.",
        ],
      },
    ],
    businessRules: [
      "El carnet de identidad es único por trabajador en todo el sistema.",
      "El estado del expediente alerta qué datos obligatorios faltan por cargar antes del procesamiento de nómina.",
    ],
    mockup: {
      headerTitle: "Trabajadores",
      headerSubtitle: "Directorio de las personas que actualmente pertenecen a esta entidad",
      badges: ["10 de 10 trabajadores", "Expedientes Digitales"],
      tableColumns: ["Trabajador", "Código", "Carnet de Identidad", "Teléfono", "Condición Plantilla", "Estado Expediente"],
      tableRows: [
        { "Trabajador": "Lázaro Fuentes Rivas", "Código": "TRB-BEFE49", "Carnet de Identidad": "87031512345", "Teléfono": "5555-1234", "Condición Plantilla": "Vinculado a plantilla", "Estado Expediente": "Ficha completa" },
        { "Trabajador": "Maria Gomez Sanchez", "Código": "TRB-000002", "Carnet de Identidad": "87654321B", "Teléfono": "600987654", "Condición Plantilla": "Vinculado a plantilla", "Estado Expediente": "Ficha incompleta (2)" },
        { "Trabajador": "isael maceo diaz", "Código": "TRB-EACFE6", "Carnet de Identidad": "96062506741", "Teléfono": "55049502", "Condición Plantilla": "Vinculado a plantilla", "Estado Expediente": "Ficha incompleta (1)" },
      ],
      actionButtons: ["Añadir filtro", "Ver Expediente Completo"],
      notes: "Captura real tomada del módulo oficial Trabajadores en SiteCorp Entidad.",
    },
  },

  // --- VISTA 08: CONTRATACIÓN Y ALTAS ---
  {
    id: "entity-hiring",
    category: "operativa",
    title: "Contratación y Cobertura de Vacantes",
    subtitle: "Cubra las vacantes de la plantilla autorizada de la entidad incorporando trabajadores",
    route: "/entity/:entityId/hiring",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.14.53_p._m._62098c2a.png",
    rolesAllowed: ["Jefe de RRHH", "Responsable de Selección y Contratación"],
    permissionsRequired: ["hiring.view", "hiring.manage", "workers.manage"],
    purpose: "Gestionar las convocatorias y cubrir las vacantes disponibles en los puestos presupuestados de la plantilla autorizada.",
    description: "Permite monitorear qué puestos tienen plazas libres, consultar la lista de ocupantes actuales y ejecutar la acción '+ Cubrir puesto' para formalizar el contrato de un nuevo colaborador asignándole fecha, puesto y salario en CUP.",
    keyElements: [
      { name: "Tarjetas de Estado de Puestos", description: "5 Puestos con vacantes, 24 Vacantes totales y 1 Puestos cubiertos." },
      { name: "Buscador de Puestos", description: "Búsqueda por 'puesto, código, cargo o área...' y filtro 'Añadir filtro (6 de 6)'." },
      { name: "Tarjetas de Puestos Vacantes", description: "Muestra Código (ej. PST-BD6DCY), Badge verde [CON VACANTES], Área, Cargo, Grupo de Escala (I/II), Salario base (ej. 3,800.00 CUP) y desglose de ocupación (ej. 6/17, 11 vacantes)." },
      { name: "Desplegable de Ocupantes", description: "Enlace 'Ver ocupantes (X)' para examinar los colaboradores que ya ocupan plazas en ese puesto." },
      { name: "Botón '+ Cubrir puesto'", description: "Dispara el formulario modal de alta y formalización laboral para asignar al trabajador en la vacante elegida." },
    ],
    workflows: [
      {
        title: "Proceso de cobertura de vacante en puesto",
        steps: [
          "Localice el puesto con vacantes (ej. Almacenero con 11 vacantes).",
          "Haga clic en '+ Cubrir puesto'.",
          "Seleccione al postulante o trabajador disponible.",
          "Estipule las fechas de contrato y condiciones salariales.",
          "Confirme el alta; la vacante quedará cubierta y se creará el registro en el padrón de trabajadores.",
        ],
      },
    ],
    businessRules: [
      "Solo los puestos con vacantes disponibles (> 0) tienen habilitado el botón '+ Cubrir puesto'.",
      "Los puestos con ocupación al 100% muestran el badge [CUBIERTO] y deshabilitan nuevas altas.",
    ],
    mockup: {
      headerTitle: "Contratación",
      headerSubtitle: "Cubra las vacantes de la plantilla autorizada de la entidad incorporando trabajadores",
      badges: ["5 Puestos con vacantes", "24 Vacantes"],
      kpis: [
        { label: "Puestos con vacantes", value: "5", color: "warning" },
        { label: "Vacantes totales", value: "24", color: "default" },
        { label: "Puestos cubiertos", value: "1", color: "success" },
      ],
      tableColumns: ["Puesto / Código", "Estado", "Área / Cargo", "Salario Base", "Ocupación", "Acción"],
      tableRows: [
        { "Puesto / Código": "Almacenero · PST-BD6DCY", "Estado": "CON VACANTES", "Área / Cargo": "Almacenes · Almacenero", "Salario Base": "3,800.00 CUP", "Ocupación": "6/17 (11 vacantes)", "Acción": "+ Cubrir puesto" },
        { "Puesto / Código": "Director · PST-FNRDYP", "Estado": "CUBIERTO", "Área / Cargo": "Direccion · Director", "Salario Base": "4,500.00 CUP", "Ocupación": "1/1 (0 vacantes)", "Acción": "Ver ocupantes (1)" },
        { "Puesto / Código": "Especialista Principal · PST-ESP-PRINC", "Estado": "CON VACANTES", "Área / Cargo": "Direccion · Especialista Principal", "Salario Base": "4,500.00 CUP", "Ocupación": "1/3 (2 vacantes)", "Acción": "+ Cubrir puesto" },
      ],
      actionButtons: ["+ Cubrir puesto", "Ver ocupantes"],
      notes: "Captura real tomada del módulo oficial Contratación en SiteCorp Entidad.",
    },
  },

  // --- VISTA 09: ALERTAS DE VENCIMIENTO DE CONTRATOS ---
  {
    id: "entity-contracts-alerts",
    category: "operativa",
    title: "Vencimientos de Contratos y Alertas",
    subtitle: "Contratos por tiempo determinado de esta entidad que requieren seguimiento",
    route: "/entity/:entityId/contracts/alerts",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.15.09_p._m._508e1ad2.png",
    rolesAllowed: ["Gerente de RRHH", "Jefe de Personal", "Asesor Jurídico"],
    permissionsRequired: ["contract_alerts.view", "workers.manage"],
    purpose: "Controlar los plazos de vigencia de contratos por tiempo determinado para prevenir vencimientos involuntarios y coordinar renovaciones o bajas a tiempo.",
    description: "Consola especializada con desglose por tramos de días restantes. Permite filtrar por estado de vencimiento, área, cargo y puesto, y consultar la tabla de contratos ordenados por fecha de término.",
    keyElements: [
      { name: "Botón 'Actualizar'", description: "Recarga el estado contractual y semáforos en tiempo real." },
      { name: "Mosaico de Semáforos de Vencimiento", description: "Requieren atención (2), Vencidos (0), Vence hoy (1), Próximos 7 días (0), 8-15 días (1), 16-30 días (0) y Más de 30 días (1)." },
      { name: "Filtros Multicriterio", description: "Buscador de trabajador (Nombre, apellidos o CI), selectores por Estado de vencimiento, Área, Cargo y Puesto, y botón 'Limpiar filtros'." },
      { name: "Tabla de Contratos en Seguimiento", description: "Columnas: Trabajador (con código TRB), CI, Área, Cargo, Puesto (con código PST), Modalidad de Contrato (ej. Por tiempo determinado), Fecha Inicio y Fecha Fin." },
    ],
    workflows: [
      {
        title: "Gestión de contratos con vencimiento inmediato",
        steps: [
          "Verifique la tarjeta 'Vence hoy' o '8-15 días'.",
          "Filtre la tabla por el estado de vencimiento correspondiente.",
          "Revise las fechas de inicio y fin del contrato por tiempo determinado.",
          "Coordine con el área correspondiente la firma de adenda de prórroga o el acta de finiquito.",
        ],
      },
    ],
    businessRules: [
      "Los contratos vencidos aparecen en primer lugar en el ordenamiento de la tabla.",
      "La categorización por días se calcula automáticamente contra la fecha actual del sistema.",
    ],
    mockup: {
      headerTitle: "Vencimientos de contratos",
      headerSubtitle: "Contratos por tiempo determinado de esta entidad que requieren seguimiento",
      badges: ["2 Requieren atención", "1 Vence hoy"],
      kpis: [
        { label: "Requieren atención", value: "2", color: "danger" },
        { label: "Vence hoy", value: "1", color: "danger" },
        { label: "8-15 días", value: "1", color: "warning" },
        { label: "Más de 30 días", value: "1", color: "default" },
      ],
      tableColumns: ["Trabajador · Código", "CI", "Área", "Cargo", "Puesto", "Contrato", "Inicio", "Fin"],
      tableRows: [
        { "Trabajador · Código": "iso qwer hqiqwjhqo · TRB-5F25A7", "CI": "96052506741", "Área": "Almacenes", "Cargo": "Almacenero", "Puesto": "Almacenero (PST-BD6DCY)", "Contrato": "Por tiempo determinado", "Inicio": "05/10/2026", "Fin": "30/10/2026" },
      ],
      actionButtons: ["Actualizar", "Limpiar filtros", "Renovar contrato"],
      notes: "Captura real tomada del módulo oficial Vencimientos de Contratos en SiteCorp Entidad.",
    },
  },

  // --- VISTA 10: PRENÓMINA ---
  {
    id: "entity-payroll-preparation",
    category: "operativa",
    title: "Prenómina y Preparación Mensual del Pago",
    subtitle: "Preparación mensual del pago · Gestión de períodos, incidencias y cálculos salariales",
    route: "/entity/:entityId/payroll-preparation",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.15.16_p._m._6d682220.png",
    rolesAllowed: ["Analista de Compensaciones", "Jefe de Nómina", "Contador"],
    permissionsRequired: ["prenomina.view", "prenomina.manage"],
    purpose: "Aperturar períodos mensuales de pago, procesar incidencias salariales y consultar el historial de nóminas procesadas o en borrador.",
    description: "Módulo central para la preparación mensual del pago en la entidad (Empresa A). Permite abrir o crear una prenómina seleccionando el mes y año, y consultar la tabla de períodos anteriores con su estado (Borrador / Cerrado), total acumulado y botón de apertura.",
    keyElements: [
      { name: "Panel 'Período'", description: "Selectores desplegables de Mes (ej. Octubre) y Año (ej. 2026) junto con el botón de acción principal 'Abrir / Crear prenómina'." },
      { name: "Panel 'Períodos anteriores'", description: "Bandeja histórica con filtro dinámico 'Añadir filtro (2 de 2)'." },
      { name: "Tabla de Períodos", description: "Columnas: Mes, Año, Estado (con badge Borrador), Total (ej. 12,068.68 o 0.00), Fecha cierre (—) y botón de acción [Abrir]." },
      { name: "Detalle Salarial y CLA", description: "Al abrir el período, despliega las columnas de salario básico, condiciones laborales anormales (CLA / nocturnidad), antigüedad y deducciones por trabajador." },
    ],
    workflows: [
      {
        title: "Apertura y revisión de la prenómina mensual",
        steps: [
          "Seleccione el Mes (ej. Octubre) y el Año (ej. 2026) en el panel 'Período'.",
          "Haga clic en 'Abrir / Crear prenómina'.",
          "Revise la tabla de períodos anteriores para ver el histórico.",
          "Haga clic en 'Abrir' en el registro deseado para inspeccionar el desglose de conceptos salariales de cada colaborador.",
        ],
      },
    ],
    businessRules: [
      "Solo puede haber un período en estado Borrador abierto a la vez.",
      "Los totales se consolidan automáticamente con los partes de asistencia y descansos médicos registrados.",
    ],
    mockup: {
      headerTitle: "Prenómina",
      headerSubtitle: "Preparación mensual del pago · Empresa A",
      badges: ["Mes: Octubre 2026", "Estado: Borrador"],
      kpis: [
        { label: "Período Activo", value: "Octubre 2026", color: "default" },
        { label: "Total Prenómina Oct", value: "12,068.68 CUP", color: "success" },
        { label: "Total Noviembre", value: "0.00 CUP", color: "warning" },
      ],
      tableColumns: ["Mes", "Año", "Estado", "Total", "Fecha cierre", "Acción"],
      tableRows: [
        { "Mes": "Noviembre", "Año": "2026", "Estado": "Borrador", "Total": "0.00", "Fecha cierre": "—", "Acción": "Abrir" },
        { "Mes": "Octubre", "Año": "2026", "Estado": "Borrador", "Total": "12,068.68", "Fecha cierre": "—", "Acción": "Abrir" },
      ],
      actionButtons: ["Abrir / Crear prenómina", "Añadir filtro", "Abrir"],
      notes: "Captura real tomada del módulo oficial Prenómina en SiteCorp Entidad.",
    },
  },

  // --- VISTA 11: SEGURIDAD Y SALUD EN EL TRABAJO (SST) ---
  {
    id: "entity-sst",
    category: "sst_bienestar",
    title: "Seguridad y Salud en el Trabajo (SST)",
    subtitle: "Prevención de riesgos laborales, capacitaciones por cargo, EPP, inspecciones y salud ocupacional",
    route: "/entity/:entityId/sst",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.15.23_p._m._2a70425c.png",
    rolesAllowed: ["Jefe de SST", "Médico Ocupacional", "Supervisor de Seguridad"],
    permissionsRequired: ["sst.view", "sst.manage"],
    purpose: "Gestionar la prevención integral de riesgos laborales, entregas de EPP, salud ocupacional e instrucción obligatoria exclusiva de la entidad.",
    description: "Consola institucional de Seguridad y Salud en el Trabajo para Empresa A. Integra avisos normativos por nuevas contrataciones, métricas en tiempo real de cobertura de SST y 4 pestañas de operación especializada.",
    keyElements: [
      { name: "Banner 'Avisos de SST pendientes'", description: "Alerta con badge '1 pendiente': Colaborador que requiere instrucción de SST, entrega de EPP o evaluación médica con botón 'Gestionar en ficha ->'." },
      { name: "Mosaico de KPIs de Prevención", description: "TRABAJADORES AL DÍA SST: 0/10 (10 pendientes); SESIONES SST: 0 realizadas; RIESGOS CRÍTICOS/ALTOS: 0; MEDIDAS VENCIDAS: 0; ENTREGAS EPP: 0; INSPECCIONES / SUCESOS: 0 accidentes." },
      { name: "Pestaña 1", description: "1. Capacitaciones por Cargo y Calendario (programación mensual e instructivos)." },
      { name: "Pestaña 2", description: "2. Riesgos, Matriz y Plan de Prevención (evaluación de peligros y matriz IPERC)." },
      { name: "Pestaña 3", description: "3. EPP e Inspecciones de Seguridad (registro de entrega de implementos y rondas)." },
      { name: "Pestaña 4", description: "4. Accidentes, Salud Ocup., Emergencias y Comité (investigaciones, EMO y comités mixtos)." },
    ],
    workflows: [
      {
        title: "Atención de aviso de SST por nueva contratación",
        steps: [
          "Verifique el banner de alerta en la parte superior del módulo de SST.",
          "Identifique el trabajador (ej. Isael Antonio maceo diaz, Cargo: Almacenero).",
          "Haga clic en 'Gestionar en ficha ->'.",
          "Registre la entrega de implementos EPP correspondientes a su puesto y la inducción de seguridad inicial.",
        ],
      },
    ],
    businessRules: [
      "Todo trabajador recién contratado genera un aviso normativo automático hasta registrar su inducción de SST y EPP.",
      "Las estadísticas de SST se sincronizan con las auditorías de cumplimiento laboral.",
    ],
    mockup: {
      headerTitle: "Seguridad y Salud en el Trabajo (SST) — Empresa A",
      headerSubtitle: "Prevención de riesgos, capacitaciones, EPP, inspecciones y salud ocupacional",
      badges: ["1 Aviso Pendiente", "Normativa SST"],
      tabs: ["1. Capacitaciones por Cargo y Calendario", "2. Riesgos, Matriz y Plan de Prevención", "3. EPP e Inspecciones de Seguridad", "4. Accidentes, Salud Ocup., Emergencias y Comité"],
      kpis: [
        { label: "TRABAJADORES AL DÍA", value: "0 / 10", trend: "10 pendientes", color: "warning" },
        { label: "SESIONES SST", value: "0", trend: "Realizadas", color: "default" },
        { label: "RIESGOS CRÍTICOS", value: "0", color: "success" },
        { label: "ENTREGAS EPP", value: "0", color: "default" },
      ],
      tableColumns: ["Submódulo SST", "Alcance", "Estado Actual", "Acción Inmediata"],
      tableRows: [
        { "Submódulo SST": "Capacitaciones por Cargo", "Alcance": "Instrucción obligatoria inicial", "Estado Actual": "1 trabajador nuevo pendiente", "Acción Inmediata": "Gestionar en ficha ->" },
        { "Submódulo SST": "Entrega de EPP", "Alcance": "Dotación de implementos de seguridad", "Estado Actual": "0 entregas registradas", "Acción Inmediata": "+ Registrar entrega" },
        { "Submódulo SST": "Exámenes Médicos (EMO)", "Alcance": "Vigilancia de aptitud física", "Estado Actual": "Evaluación periódica", "Acción Inmediata": "Ver programación" },
      ],
      actionButtons: ["Gestionar en ficha ->", "Nueva Sesión SST", "Registrar EPP"],
      notes: "Captura real tomada del módulo oficial SST en SiteCorp Entidad.",
    },
  },

  // --- VISTA 12: LICENCIAS Y CERTIFICADOS MÉDICOS ---
  {
    id: "entity-medical-certificates",
    category: "sst_bienestar",
    title: "Licencias y Certificados Médicos",
    subtitle: "Gestión de certificados médicos de los trabajadores de la entidad · Historial de eventos y descansos",
    route: "/entity/:entityId/medical-certificates",
    realImagePath: "/assets/aistudio/Captura_de_pantalla_2026-10-30_a_las_4.15.32_p._m._d89a3bb9.png",
    rolesAllowed: ["Médico Ocupacional", "Jefe de RRHH", "Analista de Nómina"],
    permissionsRequired: ["medical_certificates.view", "medical_certificates.manage"],
    purpose: "Registrar y auditar certificados médicos individuales de los trabajadores, controlando fechas de salida, reincorporación, días de descanso y documentos de sustento.",
    description: "Módulo para registrar cada certificado como un evento individual del historial del trabajador (sin saldos ni acumulaciones rígidas). Incluye el sustento documental digitalizado para la justificación del tiempo no trabajado y enlace con la prenómina.",
    keyElements: [
      { name: "Botones de Cabecera", description: "Botón 'Actualizar' y botón principal '+ Registrar certificado'." },
      { name: "Tarjetas KPI de Descansos", description: "Certificados: 1; Días por certificado: 15 d; Trabajadores con certificado: 1." },
      { name: "Barra de Filtros", description: "Selector de Año, campo 'Buscar trabajador (Nombre o carné de identidad)' y botón 'Añadir filtro (1 de 1)'." },
      { name: "Tabla 'Certificados de 2026'", description: "Columnas: Trabajador CI, Área, Salida, Reincorporación, Días, Documento." },
      { name: "Registro en Expediente", description: "isael maceo diaz (CI 96062506741), Área: Dirección, Salida: 09/10/2026, Reincorporación: 23/10/2026, 15 días, con enlace directo al archivo escaneado del certificado." },
    ],
    workflows: [
      {
        title: "Registro de un nuevo certificado médico",
        steps: [
          "Presione el botón '+ Registrar certificado' en la cabecera.",
          "Seleccione al trabajador por nombre o CI.",
          "Estipule la fecha de salida y de reincorporación.",
          "El sistema calcula automáticamente el total de días de descanso.",
          "Adjunte el documento escaneado de respaldo y confirme el guardado.",
        ],
      },
    ],
    businessRules: [
      "Cada certificado es un evento inmutable registrado en el expediente del trabajador.",
      "Los días de descanso impactan automáticamente la prenómina de la entidad.",
    ],
    mockup: {
      headerTitle: "Licencias / Certificados Médicos",
      headerSubtitle: "Gestión de los certificados médicos de los trabajadores de la entidad",
      badges: ["1 Certificado Registrado", "Año 2026"],
      kpis: [
        { label: "Certificados", value: "1", color: "default" },
        { label: "Días por certificado", value: "15 d", color: "warning" },
        { label: "Trabajadores con certificado", value: "1", color: "default" },
      ],
      tableColumns: ["Trabajador CI", "Área", "Salida", "Reincorporación", "Días", "Documento"],
      tableRows: [
        { "Trabajador CI": "isael maceo diaz (96062506741)", "Área": "Direccion", "Salida": "09/10/2026", "Reincorporación": "23/10/2026", "Días": "15", "Documento": "Certificado escaneado adjunto" },
      ],
      actionButtons: ["Actualizar", "+ Registrar certificado", "Ver Documento"],
      notes: "Captura real tomada del módulo oficial Licencias / Certificados Médicos en SiteCorp Entidad.",
    },
  },
]

export const ROLES_MATRIX = [
  {
    roleName: "Super Administrador de Plataforma",
    tier: "Global",
    description: "Control absoluto de todas las entidades, configuración técnica de la plataforma, auditoría e infraestructura.",
    permissions: ["Todas las acciones globales (platform_*) y administración de planes."],
  },
  {
    roleName: "Administrador de Entidad",
    tier: "Entidad",
    description: "Máxima autoridad de una unidad operativa. Administra usuarios locales, plantilla, ajustes y contratos.",
    permissions: ["Acceso completo a todos los submódulos de la entidad."],
  },
  {
    roleName: "Jefe de Recursos Humanos",
    tier: "Entidad",
    description: "Gestión integral de personas, candidatos, contrataciones, renovaciones, vacaciones y desvinculaciones.",
    permissions: ["workers.manage", "hiring.manage", "candidates.manage", "vacations.manage", "contract_alerts.view"],
  },
  {
    roleName: "Analista de Nómina / Compensaciones",
    tier: "Entidad",
    description: "Cálculo de la Prenómina, horas nocturnas (CLA), bonificaciones de antigüedad, incidencias y exportación bancaria.",
    permissions: ["prenomina.manage", "workers.view", "vacations.view", "medical_certificates.view"],
  },
  {
    roleName: "Supervisor de Seguridad y Salud (SST)",
    tier: "Entidad",
    description: "Control de entrega de EPP, investigación de accidentes, seguimiento a exámenes médicos ocupacionales y matriz IPERC.",
    permissions: ["sst.manage", "training.manage", "medical_certificates.view", "workers.view"],
  },
  {
    roleName: "Auditor / Observador de Entidad",
    tier: "Entidad",
    description: "Consulta de reportes, cumplimiento legal y expedientes sin facultades de modificación o cese.",
    permissions: ["workers.view", "vacations.view", "training.view", "sst.view"],
  },
]

export const GLOSSARY_TERMS = [
  {
    term: "Cuenta SiteCorp",
    definition: "Marca asignada a una entidad operativa que la habilita para utilizar la suite completa de RRHH, Nómina, SST y gestión de personal.",
  },
  {
    term: "Plan Base y Paquetes Modulares",
    definition: "Modelo comercial de licenciamiento donde el Plan Base comprende la gestión de personas y plantilla, con activación opcional de Prenómina y Capacitación/SST.",
  },
  {
    term: "CLA (Cláusula de Jornada y Nocturnidad)",
    definition: "Parámetros de horarios y sobretasa del 35% aplicados a las horas nocturnas trabajadas entre las 22:00 y las 06:00 horas.",
  },
  {
    term: "Prenómina",
    definition: "Cálculo salarial previo a la planilla definitiva donde se consolidan haberes, sobretiempos, bonos, subsidios y deducciones del periodo.",
  },
  {
    term: "EPP (Equipos de Protección Personal)",
    definition: "Implementos de seguridad individuales asignados a cada trabajador con trazabilidad de entrega y periodicidad de recambio.",
  },
  {
    term: "EMO (Exámenes Médicos Ocupacionales)",
    definition: "Evaluaciones médicas periódicas obligatorias de ley para determinar la aptitud del trabajador respecto a las tareas de su puesto.",
  },
  {
    term: "IPERC",
    definition: "Identificación de Peligros, Evaluación de Riesgos y Medidas de Control. Matriz preventiva obligatoria de la gestión de SST.",
  },
  {
    term: "CITT (Certificado de Incapacidad Temporal para el Trabajo)",
    definition: "Documento oficial expedido por Essalud que sustenta el descanso médico y habilita el cobro de subsidios a partir del día 21.",
  },
]
