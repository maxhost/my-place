// Barrel del wrapper de Vercel REST API consumido por el slice
// `custom-domain` (ADR-0026, ADR-0028, ADR-0029). Mantiene
// `src/shared/lib/vercel/` como módulo cohesivo:
//
// - `./domains` — V9/V10 project-scoped: `addDomain`, `getDomainStatus`,
//   `removeDomain` + tipos `DomainStatus`, `DnsRecord`.
// - `./domains-config` — V6 root-scoped: `getDomainConfig` + tipo
//   `DomainConfig` (ADR-0029 cierre falsa-positiva `verified`).
// - `./domains-shared` — privado al namespace: helpers + tipos
//   compartidos (`VercelResult`, `VercelErrorReason`). NO se re-exporta
//   directo; `./domains` ya re-exporta los tipos públicos.
//
// Los imports externos consumen `@/shared/lib/vercel`, nunca los
// archivos individuales — esto deja libertad para reorganizar
// internamente sin tocar consumers.

export * from "./domains";
export * from "./domains-config";
