// Setup del proyecto `ui` (jsdom): matchers de jest-dom + limpieza del DOM
// entre tests. No carga `.env.local` (los componentes no tocan DB/SDK).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Seam-split del SDK de Neon Auth (ADR-0006/0014). Tras el split del slice
// (ADR-0014) `access` consume `place-creation` vía su `public.ts`
// (feature→feature unidireccional, obligatorio por paradigma). Ese barrel
// re-exporta `createPlaceAction`, cuyo grafo arrastra `@/shared/lib/auth` →
// `@neondatabase/auth/next/server` → `next/headers`, que NO resuelve en
// jsdom (ver vitest.config.ts: la capa UI no debe arrastrar `next/headers`/
// Neon). La UI nunca ejecuta el SDK: los Server Actions se inyectan como
// props y se testean con fakes (patrón seam-split, S4b/S8/S9). Fakeamos el
// shim para que el grafo del barrel evalúe sin arrastrar Neon a la capa UI;
// si algún test UI lo invoca de verdad, falla ruidoso (no debe pasar).
vi.mock("@/shared/lib/auth", () => ({
  getAuth: () => {
    throw new Error("getAuth() no debe ejecutarse en tests UI (seam-split)");
  },
  getAuthHandler: () => {
    throw new Error(
      "getAuthHandler() no debe ejecutarse en tests UI (seam-split)",
    );
  },
}));

afterEach(() => {
  cleanup();
});
