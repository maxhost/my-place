import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// Migraciones con el rol admin (neondb_owner) — NUNCA el runtime app_system.
// El schema (src/db/schema/) se crea en S1; este config existe desde S0 listo.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATE!,
  },
  strict: true,
  verbose: true,
});
