import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Alias `@/*` → ./src/* (espeja tsconfig "paths"; Vitest no lee tsconfig).
const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

// Dos proyectos (Vitest 4 `projects`): los tests de DB/RLS corren en Node y
// conectan a Neon como `app_system`; los de componentes (S8) corren en jsdom
// con React Testing Library. Se separan por extensión —`*.test.ts` = lógica/
// DB (node), `*.test.tsx` = UI (jsdom)— para no arrastrar jsdom a la capa DB
// ni `next/headers`/Neon a la capa UI.
export default defineConfig({
  resolve: { alias },
  test: {
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
          // es el sobre de latencia real del cold-start). 30s para DB.
          testTimeout: 30_000,
          hookTimeout: 30_000,
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
