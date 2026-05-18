import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de DB/RLS corren en Node (no jsdom): conectan a Neon como `app_system`.
// Los tests de componentes (frontend, sesiones posteriores) usarán jsdom con
// su propia config/proyecto cuando existan.
export default defineConfig({
  // Alias `@/*` → ./src/* (espeja tsconfig "paths"); Vitest no lee tsconfig.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // El branch `test` de Neon escala a cero: el primer connect (WebSocket
    // neon-serverless) cold-startea el compute y tarda varios segundos; con
    // varios archivos de test en paralelo esos cold-connects se solapan. El
    // default de 5000ms es irreal para esa latencia legítima → timeouts
    // espurios (no es flakiness a tapar: es el sobre de latencia real del
    // cold-start). Se amplía a 30s para tests y hooks de DB.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
