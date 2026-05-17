// Carga .env.local en cada worker de Vitest (no lo hace solo, a diferencia de Next).
import { config } from "dotenv";

config({ path: ".env.local" });
