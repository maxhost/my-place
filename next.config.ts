import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";
import withBundleAnalyzer from "@next/bundle-analyzer";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// `ANALYZE=true pnpm build` abre el treemap. La ruta de la landing debe
// aparecer con 0 KB de First Load JS propio (README §Performance).
const withAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === "true" });

const nextConfig: NextConfig = {
  // Lockfile suelto en el home del usuario hace que Next infiera mal el
  // workspace root. Fijarlo a este repo.
  outputFileTracingRoot: path.join(__dirname),
};

export default withAnalyzer(withNextIntl(nextConfig));
