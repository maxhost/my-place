// Interfaz pública de la feature `access` (paradigma vertical-slice: las
// demás features / rutas importan SÓLO desde acá, nunca de internos).
// Vía "Acceso" account-first: login/signup + elección post-auth + wizard
// reusado en modo authed (ADR-0008/0009). La ruta
// `(marketing)/[locale]/login` la monta. Este slice depende de
// `place-wizard` (renderiza `PlaceWizard` en modo authed, ADR-0016) y de
// `place-creation` (tipo `PlaceFirstCredentials`) SOLO vía sus `public.ts`
// (feature→feature unidireccional, sin ciclo — patrón ADR-0014/0015/0016).

export { AccessFlow } from "./ui/access-flow";
export type { AccessLabels, AccessSubmit } from "./ui/access-labels";
export { loginAction, signUpAccountAction } from "./auth-actions";
