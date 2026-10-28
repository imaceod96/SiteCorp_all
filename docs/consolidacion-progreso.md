# Consolidación de Módulos DDD - Progreso

## Estado Actual
- Módulo access-control: COMPLETADO (movido a src/modules/access-control/)
- Módulos pendientes: 12

## Módulos a Migrar
1. company-client
2. contracts
3. document-generation
4. document-templates
5. entity-summary
6. organization-structure
7. payroll-movements
8. payroll-preparation
9. people
10. representatives
11. resolutions
12. vacations-licenses

## Estructura Objetivo para Cada Módulo
```
src/modules/[module-name]/
├── domain/
├── application/
│   ├── commands/
│   ├── queries/
│   └── ports/
├── infrastructure/
│   ├── persistence/
│   ├── storage/
│   └── mappers/
├── presentation/
│   ├── pages/
│   ├── components/
│   └── hooks/
└── index.ts
```

## Progreso
- [x] access-control
- [ ] company-client
- [ ] contracts
- [ ] document-generation
- [ ] document-templates
- [ ] entity-summary
- [ ] organization-structure
- [ ] payroll-movements
- [ ] payroll-preparation
- [ ] people
- [ ] representatives
- [ ] resolutions
- [ ] vacations-licenses

## Errores Conocidos (pendientes de corrección)
- 28 errores TypeScript en src/app/providers/ (auth.context.ts, current-company-client.context.ts, current-entity.context.ts, salary.context.ts)