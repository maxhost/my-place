"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Root error boundary Next 16 (ADR-0047). Captura errores que rompen el
// render del root layout — last-resort catch-all. Replaces `<html>` y
// `<body>` (este file ES el shell completo cuando algo rompe layout).
//
// Cobertura:
//   - Errores en root layout o nested layouts.
//   - Errores fuera del request scope (e.g. providers tree).
//   - El `error.tsx` per-segment cubre errores DENTRO del request scope —
//     este file solo cubre lo que escapa de TODOS esos.
//
// Mounted como Client Component (`"use client"`) porque `useEffect` es la
// forma canónica de reportar a Sentry post-hydration sin bloquear el render
// del fallback UI.
//
// El SDK Sentry Next.js ya wrappea automáticamente los errors RSC + Server
// Action vía `onRequestError` (exportado en `src/instrumentation.ts`). Este
// boundary cubre el caso edge en que el error es **del root layout** o de
// **fuera del request scope** que `onRequestError` no toca.
//
// Sin Tailwind tokens del proyecto: el root error boundary debe ser
// auto-suficiente (los providers de tema podrían ser los que rompieron).
// Inline style minimal para preservar leyibilidad sin asumir CSS cargado.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          padding: "2rem",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#faf7f0",
          color: "#1c1b22",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            Algo salió mal
          </h1>
          <p
            style={{
              fontSize: "1rem",
              color: "#6b6a73",
              marginBottom: "1.5rem",
            }}
          >
            Tuvimos un problema cargando esta página. Ya estamos al tanto.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: "#a8501e",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
