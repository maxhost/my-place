import { defineConfig } from "vitest/config";

// Tests de DB/RLS corren en Node (no jsdom): conectan a Neon como `app_system`.
// Los tests de componentes (frontend, sesiones posteriores) usarán jsdom con
// su propia config/proyecto cuando existan.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
