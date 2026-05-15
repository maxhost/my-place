import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Lockfile suelto en el home del usuario hace que Next infiera mal el
  // workspace root. Fijarlo a este repo.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
