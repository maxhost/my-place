import type { ReactNode } from "react";
import "../globals.css";

// Root layout de la zona `(app)` (place + inbox). Route groups en la raíz de
// `app/` ⇒ NO hay `app/layout.tsx` compartido: cada grupo provee su propio
// `<html>` (multi-root layout, Next 16). La zona app es producto en español
// (CLAUDE.md) y NO lleva `[locale]` — el i18n de URL es de marketing
// (ADR-0005 §10). Tema/colores por place llegan en S8 (CSS custom props).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
