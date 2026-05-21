// Barrel del wrapper de Vercel REST API consumido por el slice
// `place-settings/domain` (feature custom-domain V1, ADR-0026). Mantiene
// `src/shared/lib/vercel/` como módulo cohesivo (`addDomain`,
// `getDomainStatus`, `removeDomain` + tipos públicos del wrapper). Los
// imports externos consumen `@/shared/lib/vercel`, nunca el archivo
// `./domains` directo — esto deja libertad para reorganizar internamente
// sin tocar consumers.

export * from "./domains";
