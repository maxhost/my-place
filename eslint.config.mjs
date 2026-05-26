// Next 16: eslint-config-next exporta flat config nativo (ADR-0013). El patrón
// FlatCompat/compat.extends del scaffold de Next 15 era legacy eslintrc y
// rompe con v16 ("circular structure"); se spreadean los arrays flat directo.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Slice boundary enforcement (architecture.md §17-25, ADR-0039): el built-in
// `no-restricted-imports` cubre los 2 inviolables del paradigma vertical-slice.
// Path B: regla strict (sólo `/public`) + escape hatch puntual vía
// `eslint-disable-next-line` cuando el barrel arrastra `"use server"` y un
// test puro necesita deep-import al archivo de definición.
const sliceBoundaryRules = [
  {
    // Regla 1 (cross-slice): cualquier archivo del repo sólo puede importar
    // de otra feature vía `@/features/<slice>/public`. Intra-slice se hace
    // con paths relativos (`../actions/foo`) — el grep `from "@/features/X"`
    // dentro de la propia feature X es vacío por convención.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Regex con lookahead negativo: matchea cualquier import
              // `@/features/<slice>/<subpath>` donde `<subpath>` no comienza
              // con `public` (ni el propio barrel ni nested `public/**`).
              // Los extglob minimatch `!(public)` NO se expanden en
              // `no-restricted-imports` patterns — verificado empíricamente
              // en S10.5.5 con el caso `custom-domain-verification`.
              regex: "^@/features/[^/]+/(?!public(?:$|/))[^/]+",
              message:
                "Cross-slice imports sólo via @/features/<slice>/public (architecture.md §17-25, ADR-0039).",
            },
          ],
        },
      ],
    },
  },
  {
    // Regla 2 (shared/): NUNCA importa de features/ — primitivos compartidos
    // viven en `shared/ui/` o `shared/lib/` (precedente: app-shell ADR-0023).
    // Más estricta que la regla 1; el rule config se reemplaza para estos
    // archivos (ESLint flat config no merge-ea options de la misma rule).
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/features/*/**"],
              message:
                "shared/ NUNCA importa de features/ — extraé el primitivo a shared/ (architecture.md §17-25, ADR-0039).",
            },
          ],
        },
      ],
    },
  },
];

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...sliceBoundaryRules,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
