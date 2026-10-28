import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Ignorados GLOBALES del lint (no se analizan ni se reportan).
    //
    // `e2e-tests/fixtures/dyad/**` es código AUTOGENERADO por Dyad: está ignorado por
    // Git y se regenera, así que cualquier arreglo manual se pierde y solo reaparece
    // como ruido recurrente (patrones de destructuración vacíos y el callback de
    // fixture llamado `use`, que react-hooks confunde con el hook `use()` de React 19).
    // Se excluye EXCLUSIVAMENTE ese árbol generado: `src/`, los servicios, las pruebas
    // escritas a mano y el resto de `e2e-tests/` conservan todas las reglas activas.
    ignores: ["dist", "e2e-tests/fixtures/dyad/**"],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
