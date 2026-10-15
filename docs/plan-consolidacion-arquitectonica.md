# Plan de Consolidación Arquitectónica - SiteCorp

## 1. Diagnóstico de la Arquitectura Actual

### Estado Actual
El proyecto presenta una arquitectura híbrida donde coexiste:
- Una capa DDD bien definida en `src/domains/` con separación clara de responsabilidades (domain, application, infrastructure)
- Código legado en capas de presentación y servicios transversales ubicados en:
  - `src/pages/` (44 páginas/routers)
  - `src/components/` (~150 componentes, incluyendo shadcn/ui y sitecorp-*)
  - `src/hooks/` (9 hooks personalizados)
  - `src/contexts/` (Auth, CurrentCompanyClient, CurrentEntity, Salary)
  - `src/lib/` (~40 módulos de orquestación y mapeo de datos)
  - `src/utils/` y `src/lib/utils.ts` (utilidades compartidas)
  - `src/data/` (datos estáticos como provincias/municipios de Cuba)

### Hallazgos Positivos
- Los dominios DDD están correctamente estructurados con:
  - Lógica de negocio pura en `/domain/` (reglas, entidades)
  - Casos de uso en `/application/` (commands, queries, ports)
  - Implementaciones de infraestructura en `/infrastructure/` (repositorios, mappers)
- El acceso a Supabase está correctamente confinado a las capas de infraestructura
- No se encontró acceso directo a Supabase desde páginas, componentes o hooks (solo referencias en comentarios)
- Los dominios muestran buen acoplamiento y cohesión

### Hallazgos de Riesgo
- 172 errores y 25 advertencias de ESLint (aunque `pnpm run build` y `tsc -b` son correctos)
- No existe script de `typecheck` definido en package.json (se usa `tsc -b` directamente)
- El proyecto no tiene tests automatizados (no hay vitest/jest)
- El `.env` apunta a proyecto Supabase en la nube con datos reales
- No hay Supabase local configurado (no hay `supabase/config.toml` ni `supabase/start`)

## 2. Árbol Propuesto de la Arquitectura Final

```
src/
  app/
    routing/           # Rutas de la aplicación (reorganizadas de src/pages/)
    providers/         # Contextos y providers (de src/contexts/)
    composition/       # Composición de features y dependencias
  
  modules/
    people/            # Módulo de personas (de src/domains/people/)
      domain/
      application/
        commands/
        queries/
        ports/
      infrastructure/
        persistence/
        storage/
        mappers/
      presentation/
        pages/         # Páginas específicas del módulo
        components/    # Componentes específicos del módulo
        hooks/         # Hooks específicos del módulo
      index.ts         # API pública del módulo
    
    contracts/
      [misma estructura que people]
    
    access-control/
      [misma estructura que people]
      
    organization-structure/
      [misma estructura que people]
      
    document-generation/
      [misma estructura que people]
      
    document-templates/
      [misma estructura que people]
      
    payroll-preparation/
      [misma estructura que people]
      
    payroll-movements/
      [misma estructura que people]
      
    vacations-licenses/
      [misma estructura que people]
      
    representatives/
      [misma estructura que people]
      
    resolutions/
      [misma estructura que people]
      
    entity-summary/
      [misma estructura que people]
      
    company-client/
      [misma estructura que people]
  
  shared/
    ui/                # Componentes UI genuamente compartidos (botones, inputs, modals, etc.)
    hooks/             # Hooks compartidos entre módulos (useToast, useApi, etc.)
    utils/             # Utilidades transversales (formatos, helpers, etc.)
    types/             # Types compartidos entre módulos
  
  integrations/
    supabase/          # Configuración y tipos de Supabase
    [otros servicios externos]
```

## 3. Inventario de Duplicaciones

### Duplicaciones Reales Encontradas
No se encontraron duplicaciones reales de funciones con misma responsabilidad y comportamiento. El código parece estar bien particionado en dominios.

### Duplicaciones Parciales Identificadas
1. **Validaciones de formularios**:
   - Similares patrones de validación en diferentes dominios (people, contracts, etc.)
   - Diferencias: reglas de negocio específicas por dominio (ej: validación de contrato vs validación de persona)
   - Ubicación: `src/domains/*/domain/rules.ts`

2. **Hooks de uso común**:
   - Patrones similares en hooks para carga de datos, manejo de estado, etc.
   - Ejemplos: `use-entity-filters.ts`, `use-entity-summary.ts`, `use-contract-alerts.ts`
   - Diferencias: filtros específicos, entidades consultadas, endpoints

3. **Utilidades de formato**:
   - Funciones de formato de moneda, fechas, números identificadas en múltiples lugares
   - Ubicación actual: `src/lib/utils.ts`, `src/utils/`, dentro de dominios

### Similar No Duplicado
- Funciones con nombres similares pero reglas de negocio distintas (ej: diferentes tipos de validación de salario según módulo)
- Componentes UI que se ven similares pero pertenecen a contextos de dominio diferentes

## 4. Inventario de Código Legado

### Legado Activo (Aún Utilizado)
1. **Contextos de Auth y Sesión**:
   - `src/contexts/AuthContext.ts`, `src/contexts/AuthProvider.tsx`
   - `src/contexts/CurrentCompanyClientContext.ts`, `src/contexts/CurrentCompanyClientProvider.tsx`
   - `src/contexts/CurrentEntityContext.ts`, `src/contexts/CurrentEntityProvider.tsx`
   - `src/contexts/SalaryContext.ts`, `src/contexts/SalaryProvider.tsx`
   - **Razón**: Manejan estado global de autenticación y sesión que aún no está completamente migrado al dominio

2. **Utilidades y Librerías**:
   - `src/lib/supabase.ts` - Cliente de Supabase configurado
   - `src/lib/utils.ts` - Funciones de utilidad general
   - `src/lib/documents.ts` - Funciones relacionadas con generación de documentos
   - `src/utils/*` - Utilidades diversas (roman-numerals, ci, toast)
   - **Razón**: Funciones transversales utilizadas por múltiples dominios

3. **Hooks Personalizados**:
   - `src/hooks/*` - Hooks que encapsulan lógica de dominio o acceso a datos
   - **Razón**: Algunos encapsulan casos de uso que deberían estar en la capa application

### Legado Sin Uso Demostrado
No se identificó código claramente sin uso mediante análisis estático básico. Se requeriría验证 de referencias más profundo.

## 5. Matriz de Movimientos de Archivos

### De `src/pages/` a `src/modules/[domain]/presentation/pages/`
```
src/pages/Index.tsx                    → src/modules/organization-structure/presentation/pages/
src/pages/Login.tsx                    → src/modules/access-control/presentation/pages/
src/pages/Admin.tsx                    → src/modules/access-control/presentation/pages/
src/pages/AdminSettingsSalaryScale.tsx → src/modules/organization-structure/presentation/pages/
src/pages/CandidateDetail.tsx          → src/modules/people/presentation/pages/
src/pages/CandidateEdit.tsx            → src/modules/people/presentation/pages/
src/pages/Candidates.tsx               → src/modules/people/presentation/pages/
[continúa para todas las páginas...]
```

### De `src/components/` a `src/modules/[domain]/presentation/components/`
```
src/components/addendums/*             → src/modules/contracts/presentation/components/
src/components/AreaForm.tsx            → src/modules/organization-structure/presentation/components/
src/components/candidates/*            → src/modules/people/presentation/components/
src/components/company-client-layout.tsx → src/modules/company-client/presentation/components/
src/components/contracts/*             → src/modules/contracts/presentation/components/
[continúa para todos los componentes...]
```

### De `src/hooks/` a `src/modules/[domain]/presentation/hooks/` o `src/shared/hooks/`
```
src/hooks/use-entity-filters.ts        → Análisis requerido: si es específico de dominio → módulo correspondiente
src/hooks/use-entity-summary.ts        → Análisis requerido: si es específico de dominio → módulo correspondiente
src/hooks/use-contract-alerts.ts       → src/modules/contracts/presentation/hooks/
src/hooks/use-medical-certificates.ts  → src/modules/vacations-licenses/presentation/hooks/
src/hooks/use-toast.ts                 → src/shared/hooks/ (utilidad compartida)
src/hooks/use-mobile.tsx               → src/shared/hooks/ (utilidad de dispositivo)
src/hooks/use-sc404.ts                 → src/shared/hooks/ (utilidad de routing)
src/hooks/use-vacations.ts             → src/modules/vacations-licenses/presentation/hooks/
```

### De `src/contexts/` a `src/app/providers/`
```
src/contexts/AuthContext.ts            → src/app/providers/auth.context.ts
src/contexts/AuthProvider.tsx          → src/app/providers/auth.provider.tsx
src/contexts/CurrentCompanyClientContext.ts → src/app/providers/current-company-client.context.ts
[continúa para todos los contextos...]
```

### De `src/lib/` y `src/utils/` a ubicación apropiada
```
src/lib/supabase.ts                    → src/integrations/supabase/client.ts
src/lib/utils.ts                       → src/shared/utils/ (funciones verdaderamente compartidas)
src/lib/documents.ts                   → Análisis: probablemente módulo document-generation
src/utils/ci.ts                        → src/shared/utils/
src/utils/roman-numerals.ts            → src/shared/utils/
src/utils/toast.ts                     → src/shared/hooks/use-toast.ts (si es un hook) o shared/utils
```

### De `src/integrations/` (mantener estructura pero revisar)
```
src/integrations/supabase/             → Mantener (configuración de Supabase)
```

## 6. Dependencias y Riesgos

### Dependencias que Necesitan Corrección
1. **Importaciones entre módulos**:
   - Después del movimiento, actualizar importaciones de componentes, hooks y utils
   - Ejemplo: Cambiar `from "@/hooks/use-toast"` a `from "@/shared/hooks/use-toast"` o desde el mismo módulo

2. **Referencias a rutas**:
   - Actualizar rutas en `<Link>` y `useRouter()` que apuntaban a `src/pages/`
   - Actualizar redirects y programmatic navigation

3. **Dependencias circulares potenciales**:
   - Verificar que ningún módulo dependa de otro de forma circular después de la reorganización
   - Especial atención a módulos con alta interacción (people, contracts, organization-structure)

### Riesgos de Regresión
1. **Riesgo Alto**: Cambios en rutas de importación que puedan romper la aplicación
   - **Mitigación**: Crear mapa de importaciones antes y después, usar busca y reemplazo cuidadoso

2. **Riesgo Medio**: Estado de contextos no migrado correctamente
   - **Mitigación**: Migrar contextos uno por uno, verificar autenticación y sesión después de cada cambio

3. **Riesgo Bajo**: Pérdida de funcionalidad en hooks movidos
   - **Mitigación**: Mantener hooks en lugar original hasta verificar que el nuevo ubicación funciona

4. **Riesgo Bajo**: Duplicación accidental de código durante el movimiento
   - **Mitigación**: Revisar cada movimiento para verificar si la funcionalidad ya existe en el destino

### Riesgos Específicos por Área
- **Auth Context**: Crítico para acceso a la aplicación
- **Rutas de navegación**: Afecta toda la experiencia de usuario
- **Hooks de datos**: Puede afectar carga y visualización de información
- **Utilidades de formato**: Afecta presentación de datos en toda la app

## 7. Plan de Ejecución Agrupado

### Fase 1: Preparación y Análisis (Semana 1)
- [ ] Crear backup completo del estado actual
- [ ] Documentar todas las importaciones externas críticas
- [ ] Crear scripts de validación para verificar que la app compile después de cada movimiento
- [ ] Definir criterios de aceptación para cada módulo migrado

### Fase 2: Infraestructura Compartida (Semana 2)
- [ ] Crear estructura de directorios objetivo en `src/modules/` y `src/shared/`
- [ ] Mover `src/lib/supabase.ts` → `src/integrations/supabase/client.ts`
- [ ] Identificar y mover funciones verdaderamente compartidas de `src/lib/utils.ts` y `src/utils/` a `src/shared/utils/`
- [ ] Mover hooks genuinamente compartidos (`use-toast`, `use-mobile`, `use-sc404`) a `src/shared/hooks/`
- [ ] Actualizar todas las importaciones afectadas

### Fase 3: Migración de Contextos (Semana 3)
- [ ] Mover `src/contexts/` → `src/app/providers/`
- [ ] Actualizar uso en `src/main.tsx` y cualquier otro lugar
- [ ] Verificar que autenticación y sesión funcionen correctamente

### Fase 4: Migración de Módulos por Dominio (Semanas 4-8)
**Orden recomendado** (de menos a más dependiente):
1. `access-control` (base para otros módulos)
2. `company-client` 
3. `people` (muchos otros dependen de él)
4. `organization-structure`
5. `contracts`
6. `document-templates`
7. `document-generation`
8. `payroll-preparation`
9. `payroll-movements`
10. `vacations-licenses`
11. `entity-summary`
12. `representatives`
13. `resolutions`

**Por dominio**:
- [ ] Crear estructura de módulo en `src/modules/[domain]/`
- [ ] Mover dominio DDD existente desde `src/domains/[domain]` → `src/modules/[domain]/` (manteniendo estructura domain/application/infrastructure)
- [ ] Identificar y mover páginas, componentes y hooks relacionados desde `src/pages/`, `src/components/`, `src/hooks/`
- [ ] Crear `presentation/` subestructura dentro del módulo
- [ ] Actualizar importaciones internas del módulo
- [ ] Verificar que el módulo compile y sus pruebas pasen
- [ ] Validar funcionalidad clave mediante pruebas manuales

### Fase 5: Limpieza y Optimización (Semana 9)
- [ ] Eliminar directorios vacíos legacy: `src/pages/`, `src/components/`, `src/hooks/`, `src/contexts/`, `src/lib/`, `src/utils/`
- [ ] Revisar `src/shared/` para asegurar que solo contenga código verdaderamente compartido
- [ ] Ejecutar suite completa de pruebas
- [ ] Realizar pruebas de integración en flujos críticos

### Fase 6: Validación Final (Semana 10)
- [ ] Verificar que no quedan referencias a directorios legacy
- [ ] Confirmar que todos los módulos siguen los límites de dominio
- [ ] Documentar arquitectura final
- [ ] Obtener aprobacion del equipo

## 8. Criterios Objetivos para Declarar Completada la Consolidación

### Criterios Estructurales
- [ ] Todos los archivos de negocio están ubicados dentro de `src/modules/[domain]/` siguiendo la estructura DDD estándar
- [ ] `src/shared/` contiene únicamente código genuamente compartido entre múltiples dominios
- [ ] `src/app/` contiene únicamente configuración de aplicación (routing, providers, composition)
- [ ] `src/integrations/` contiene únicamente configuración de servicios externos
- [ ] Los directorios legacy (`src/pages/`, `src/components/`, `src/hooks/`, `src/contexts/`, `src/lib/`, `src/utils/`) están eliminados o vacíos

### Criterios de Dependencia
- [ ] No existen importaciones desde directorios legacy eliminados
- [ ] Las importaciones entre módulos siguen la regla: un módulo solo puede depender de dominios con los que tenga una relación de negocio clara
- [ ] Todas las importaciones a funcionalidades compartidas usan el prefijo `src/shared/`

### Criterios de Arquitectura
- [ ] Cada módulo expone únicamente su API pública mediante su `index.ts` (no expone detalles internos de infrastructure o application)
- [ ] La lógica de negocio reside exclusivamente en `/domain/` y `/application/` de cada módulo
- [ ] El acceso a datos externos (Supabase, APIs) está confinado a `/infrastructure/` de cada módulo
- [ ] Las capas de presentación (`/presentation/`) contienen únicamente código de UI y presentación, sin lógica de negocio

### Criterios de Calidad
- [ ] La aplicación compila sin errores
- [ ] Al menos el 80% de las pruebas unitarias existentes pasan
- [ ] Los flujos críticos de usuario (login, navegación básica, operaciones principales) funcionan correctamente en pruebas manuales
- [ ] No se introdujeron nuevas dependencias externas sin justificación documentada

### Criterios de Documentación
- [ ] El documento `docs/plan-consolidacion-arquitectonica.md` está completo y refleja el estado final
- [ ] Cada módulo tiene un `README.md` básico que describe su responsabilidad y límites