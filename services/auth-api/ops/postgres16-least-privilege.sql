-- =============================================================================
-- SITECORP — FASE 4G.8: CONFIGURACIÓN DE MÍNIMO PRIVILEGIO EN POSTGRESQL 16
-- =============================================================================
-- Separa estrictamente:
--   1. sitecorp_migrator: propietario de esquemas y objetos DDL (usado sólo en migraciones).
--   2. sitecorp_app_runtime: rol de ejecución de la API (NOSUPERUSER, NOCREATEDB,
--      NOCREATEROLE, sin permisos DDL de CREATE/ALTER/DROP sobre esquemas).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitecorp_migrator') THEN
    CREATE ROLE sitecorp_migrator LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sitecorp_app_runtime') THEN
    CREATE ROLE sitecorp_app_runtime LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Revocar privilegios de creación DDL en public y sitecorp_auth para PUBLIC y runtime
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM sitecorp_app_runtime;
REVOKE ALL ON SCHEMA sitecorp_auth FROM PUBLIC;
REVOKE CREATE ON SCHEMA sitecorp_auth FROM sitecorp_app_runtime;

-- Otorgar únicamente USAGE de esquemas al rol de ejecución
GRANT USAGE ON SCHEMA public TO sitecorp_app_runtime;
GRANT USAGE ON SCHEMA sitecorp_auth TO sitecorp_app_runtime;

-- Otorgar permisos DML estrictos (SELECT, INSERT, UPDATE, DELETE) sobre tablas de negocio y auth
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sitecorp_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sitecorp_auth TO sitecorp_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sitecorp_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sitecorp_auth TO sitecorp_app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO sitecorp_app_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sitecorp_auth TO sitecorp_app_runtime;

-- Impedir que el rol de ejecución modifique la tabla de control de migraciones
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE sitecorp_auth.schema_migrations FROM sitecorp_app_runtime;
GRANT SELECT ON TABLE sitecorp_auth.schema_migrations TO sitecorp_app_runtime;

-- Privilegios por defecto para futuras tablas creadas por sitecorp_migrator
ALTER DEFAULT PRIVILEGES FOR ROLE sitecorp_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sitecorp_app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE sitecorp_migrator IN SCHEMA sitecorp_auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sitecorp_app_runtime;
