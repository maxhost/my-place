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
  },
});
