// Interfaz pública de la feature `access` (paradigma vertical-slice: las
// demás features / rutas importan SÓLO desde acá, nunca de internos).
// Vía "Acceso" account-first: login | signup → navigate cross-subdomain al
// Hub (`app.place.community/{locale}/`). Post-S5c del Hub V1 ya no cubre
// "elegir qué hacer post-auth" ni "crear place desde el form de Acceso" —
// esos flujos viven en el Hub (CTA del estado vacío → `/crear?from=hub` →
// wizard authed). Por eso este slice DEJA de depender de `place-wizard`
// (ADR-0016 superada en su parte cross-slice; ADR-0008/0009 simplificadas).
// Sólo depende de `place-creation` (tipo `PlaceFirstCredentials`) vía su
// `public.ts` — feature→feature unidireccional, sin ciclo
// (patrón ADR-0014/0015).

export { AccessFlow } from "./ui/access-flow";
export type { AccessLabels, AccessSubmit } from "./ui/access-labels";
export { loginAction, signUpAccountAction } from "./auth-actions";
