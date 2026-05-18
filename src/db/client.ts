import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Driver neon-serverless (WebSocket): la saga/los seams de auth necesitan
// transacciones interactivas (neon-http no sirve) — ADR-0006/0011. En Node
// hay que proveer el WebSocket; en runtime de Vercel ya existe.
neonConfig.webSocketConstructor = ws;

// Runtime de queries de dominio: rol `app_system` (NO-admin, sin BYPASSRLS)
// vía DATABASE_URL — así las policies RLS aplican. `neondb_owner` (admin,
// BYPASSRLS) NUNCA en runtime, solo migraciones. El wrapper Drizzle (ADR-0004)
// se reintroduce con la primera feature (stack.md § "patrón a reimplementar");
// este módulo expone el pool que consume la costura de auth
// (`getAuthenticatedDb`), que necesita tx interactiva de bajo nivel.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
