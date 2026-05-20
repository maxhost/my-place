"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CloseIcon, MenuIcon } from "./icons";

// Drawer mobile del hub (S3 del Hub V1). Wrapper Client agnóstico: cualquier
// contenido como children. V1 envuelve `<Sidebar />`, futuro puede envolver
// cualquier panel mobile-first (e.g., menú de filtros si se agrega).
//
// State interno (compose-friendly: el parent no gobierna). Cierres: overlay
// click + tecla ESC + botón close visible. Touch target del hamburger
// `min-h-11 min-w-11` (≥44×44 px = WCAG 2.5.5 Level AAA target size).
// Transición CSS `motion-safe:duration-200` — `prefers-reduced-motion` la
// neutraliza automáticamente vía media query Tailwind (`motion-reduce:`).
//
// Visibilidad responsive (hidden en md+) la decide el parent vía el wrapper
// que envuelve este componente: este componente NO asume desktop/mobile,
// sólo es un drawer toggle-able.

type Props = {
  openLabel: string;
  closeLabel: string;
  dialogLabel: string;
  children: ReactNode;
};

export function SidebarDrawer({
  openLabel,
  closeLabel,
  dialogLabel,
  children,
}: Props) {
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={openLabel}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink hover:bg-bg"
      >
        <MenuIcon />
      </button>

      {isOpen && (
        <>
          <div
            data-testid="drawer-overlay"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-ink/40 motion-safe:duration-200"
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={dialogLabel}
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl motion-safe:duration-200"
          >
            <div className="flex items-center justify-end p-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={closeLabel}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink hover:bg-bg"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{children}</div>
          </aside>
        </>
      )}
    </>
  );
}
