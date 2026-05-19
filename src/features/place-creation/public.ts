// Interfaz pública de la feature `place-creation` (paradigma vertical-slice:
// las demás features / rutas importan SÓLO desde acá, nunca de internos).
// Dominio + saga + Server Action de creación de place (ADR-0005). La UI del
// wizard se movió al slice `place-wizard` (ADR-0016); este slice ya no expone
// UI. `place-wizard` consume desde acá los tipos del contrato de creación y
// el primitivo `slugSchema` (arista feature→feature unidireccional, vía esta
// interfaz, acíclica — mismo patrón que ADR-0014/0015). `place-creation` no
// importa ninguna feature.

export { createPlaceAction } from "./actions";
export type { PlaceFirstCredentials } from "./actions";
export type { CreatePlaceResult } from "./create-place";
export type { CreatePlaceInput } from "./domain/schema";

// Primitivos de dominio que `place-wizard` consume (ADR-0016): `slugSchema`
// para la clasificación de slug client-side (afordancia, no autoritativa) y
// la paleta de marca default. La asistencia LLM propose-only vive en el slice
// `style-assist` (ADR-0015); el wizard la consume vía su `public.ts`.
export { slugSchema } from "./domain/schema";
export { PAPEL_PALETTE } from "./domain/defaults";
