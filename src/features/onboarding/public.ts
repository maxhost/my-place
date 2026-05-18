// Interfaz pública de la feature `onboarding` (paradigma vertical-slice: las
// demás features importan SÓLO desde acá, nunca de internos). S8 (wizard
// place-first) y S9 (vía "Acceso", modo authed) consumen esto.

export { createPlaceAction } from "./actions";
export type { PlaceFirstCredentials } from "./actions";
export type { CreatePlaceResult } from "./create-place";
export type { CreatePlaceInput } from "./domain/schema";
