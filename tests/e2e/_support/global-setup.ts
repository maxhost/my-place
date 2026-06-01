import { cleanupE2EData } from "./db-cleanup";

// Pre-clean defensivo (Phase 2.A): barre cualquier huérfano de un run previo
// que haya crasheado antes de su teardown, para que la suite arranque siempre
// de un estado conocido. El cleanup matchea por patrón de email de test, nunca
// toca data real del branch. Ver docs/testing.md.
export default async function globalSetup(): Promise<void> {
  const { places, users } = await cleanupE2EData();
  if (places > 0 || users > 0) {
    console.log(
      `[e2e setup] pre-clean: ${users} usuario(s) + ${places} place(s) ` +
        `huérfanos barridos antes de la suite`,
    );
  }
}
