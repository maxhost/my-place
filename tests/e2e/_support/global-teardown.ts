import { cleanupE2EData } from "./db-cleanup";

// Teardown post-run (Phase 2.A): borra TODA la data sembrada por los specs
// (matching el patrón de email de test) del branch `test` de Neon. Garantiza
// que la suite no deje rastro (acceptance 2.A: "cleanup test post-run"). Ver
// docs/testing.md §"Convención de datos de test".
export default async function globalTeardown(): Promise<void> {
  const { places, users } = await cleanupE2EData();
  console.log(
    `[e2e teardown] cleanup: ${users} usuario(s) + ${places} place(s) ` +
      `de test borrados del branch test`,
  );
}
