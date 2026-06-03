import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Alias `@/*` → ./src/* (espeja tsconfig "paths"; Vitest no lee tsconfig).
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// ¿Corremos con cobertura? El script `test:coverage` setea `COVERAGE=1`; el
// flag `--coverage` también lo detecta. La instrumentación v8 agrega overhead
// por worker que, sumado al cold-connect del branch `test` de Neon
// (scale-to-zero) bajo forks paralelos, empuja el cold-start de DB por encima
// del timeout de 30s calibrado para runs SIN instrumentar → "Hook timed out"
// espurios (evidencia: 71 timeouts en el full run de coverage 2.C.3, mientras
// `test:node`/`test:ui` sin coverage dan verde a 30s). Bajo coverage damos
// 60s de sobre; en runs normales el 30s documentado abajo queda intacto.
const underCoverage =
  process.env.COVERAGE === "1" || process.argv.includes("--coverage");
const nodeDbTimeout = underCoverage ? 60_000 : 30_000;

// Dos proyectos (Vitest 4 `projects`): los tests de DB/RLS corren en Node y
// conectan a Neon como `app_system`; los de componentes (S8) corren en jsdom
// con React Testing Library. Se separan por extensión —`*.test.ts` = lógica/
// DB (node), `*.test.tsx` = UI (jsdom)— para no arrastrar jsdom a la capa DB
// ni `next/headers`/Neon a la capa UI.
export default defineConfig({
  resolve: { alias },
  test: {
    // Coverage v8 (Phase 2.C.3). Se configura a nivel raíz —NO por project—
    // porque Vitest mergea nativamente la cobertura de ambos projects (`node`
    // + `ui`) en un único reporte en una sola corrida (`vitest run --coverage`
    // = `pnpm test:coverage`). El project `node` aporta la cobertura de
    // lógica/actions/_lib (`.test.ts`); el `ui` la de componentes (`.test.tsx`).
    coverage: {
      provider: "v8",
      // `json-summary` + `json` los consume el comment de PR en CI
      // (davelosert/vitest-coverage-report-action); `text` para la consola
      // local; `html` para inspección puntual (gitignored).
      reporter: ["text", "json", "json-summary", "html"],
      reportsDirectory: "./coverage",
      // Mide TODO `src` (no sólo lo tocado por tests) → el % global no miente
      // por archivos sin tests. Excluimos: tests + helpers de test, type-only
      // (`.d.ts` y `types.ts` puros = 0 statements ejecutables), las
      // migraciones SQL/meta de Drizzle (no es TS de runtime), y el setup.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/__tests__/**",
        "**/*.d.ts",
        "src/db/migrations/**",
        "src/**/types.ts",
      ],
      // Reporta aunque algún test falle / algún umbral no se cumpla — así el
      // comment de PR se postea igual (mostrando el porqué del fail), no sólo
      // en verde.
      reportOnFailure: true,
      // Thresholds = piso de NO-REGRESIÓN, calibrados contra la medición de
      // 2.C.3 (2026-06-02). Regla: nunca por encima de lo medido (un piso que
      // rompe CI de entrada no es un piso, es un bug). Subir un piso = trabajo
      // futuro con su propia evidencia.
      thresholds: {
        // Global medido: statements 70.78 / branches 72.64 / functions 69.46 /
        // lines 71.59. 70 honra el target "70% global" del tracker en 3 de 4
        // métricas. `functions` queda en 68 (medido 69.46, sub-70 por un pelo):
        // pinearlo en 70 rompería ante la mínima fluctuación. Subir a 70 cuando
        // funcciones nuevas lleguen con sus tests.
        statements: 70,
        branches: 70,
        functions: 68,
        lines: 70,
        // access: el target "85%" del tracker se CUMPLE con holgura (90-96%).
        // El piso lo fija ahí y bloquea cualquier regresión bajo 85.
        "src/features/access/**": {
          statements: 85,
          branches: 85,
          functions: 85,
          lines: 85,
        },
        // invitations: target "85%" del tracker CUMPLIDO (medido 92.20 / 87.61
        // / 90.32 / 95.68 tras los unit mockeados de los 3 wrappers de action
        // —`accept`/`create`/`revoke-invitation.ts`— en 2.C.3). `branches`
        // 87.61 es la métrica más ajustada (2.6pp sobre el piso).
        "src/features/invitations/**": {
          statements: 85,
          branches: 85,
          functions: 85,
          lines: 85,
        },
      },
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.test.ts"],
          // El branch `test` de Neon escala a cero: el primer connect
          // (WebSocket neon-serverless) cold-startea el compute y tarda
          // varios segundos; con varios archivos en paralelo esos
          // cold-connects se solapan. El default de 5000ms es irreal para esa
          // latencia legítima → timeouts espurios (no es flakiness a tapar:
          // es el sobre de latencia real del cold-start). 30s para DB, 60s
          // bajo coverage (ver `nodeDbTimeout` arriba: la instrumentación v8
          // ensancha el sobre del cold-connect).
          testTimeout: nodeDbTimeout,
          hookTimeout: nodeDbTimeout,
        },
      },
      {
        resolve: { alias },
        // JSX automático (React 19, sin import de React por archivo) lo
        // resuelve el transformer por defecto de Vite 8 (oxc).
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ui.ts"],
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
});
