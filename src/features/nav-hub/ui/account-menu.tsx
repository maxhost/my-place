"use client";

import { useEffect, useRef, useState } from "react";
import { computeInitials } from "@/shared/lib/initials";
import { LogoutIcon } from "./icons";

// Account menu del hub (S3 del Hub V1). Dropdown anclado al avatar de la
// topbar. V1 sólo expone "Cerrar sesión" (Server Action inyectada como prop —
// patrón seam-split del repo: la UI no toca el SDK, recibe la acción y la
// invoca con un fake en tests).
//
// `onLogout` retorna `{redirectTo}`; el componente navega con
// `window.location.assign(redirectTo)` (cross-subdomain seguro — el server
// no hace `redirect()` para evitar fricciones de Next 16 con orígenes
// distintos; ver plan-sesiones.md §S3 "Decisiones"). Durante el pending el
// item se renderea con label alternativo y `aria-disabled="true"` para
// evitar doble click.

type LogoutResult = { redirectTo: string };

const defaultNavigate = (url: string) => window.location.assign(url);

type Props = {
  triggerLabel: string;
  logoutLabel: string;
  logoutPendingLabel: string;
  displayName: string | null;
  onLogout: () => Promise<LogoutResult>;
  /**
   * Navegación post-logout. Default: `window.location.assign`. Se inyecta
   * sólo en tests (jsdom no permite spyOn sobre window.location.assign de
   * forma estable). Producción usa el default sin pasarlo.
   */
  navigate?: (url: string) => void;
};

export function AccountMenu({
  triggerLabel,
  logoutLabel,
  logoutPendingLabel,
  displayName,
  onLogout,
  navigate = defaultNavigate,
}: Props) {
  const [isOpen, setOpen] = useState(false);
  const [isPending, setPending] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Cierre por click afuera: mousedown en document fuera del ref → close.
  // mousedown (no click) garantiza que cerramos antes de que el target afuera
  // dispare su propio onClick (e.g., otro botón ajeno al menú).
  useEffect(() => {
    if (!isOpen) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapperRef.current && !wrapperRef.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  async function handleLogout() {
    if (isPending) return;
    setPending(true);
    try {
      const { redirectTo } = await onLogout();
      navigate(redirectTo);
      // No reseteamos pending: la navegación destruye el componente.
    } catch {
      // Si la action falla, recuperamos el estado para que el user pueda
      // reintentar. El error visible (toast/notice) es responsabilidad de
      // futuras iteraciones; V1 sólo evita el lock-down silencioso.
      setPending(false);
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-bg text-ink hover:bg-border"
      >
        <Avatar displayName={displayName} />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border bg-surface shadow-lg motion-safe:duration-150"
        >
          <button
            type="button"
            role="menuitem"
            aria-disabled={isPending ? "true" : undefined}
            disabled={isPending}
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 min-h-11 text-left text-ink hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="shrink-0 text-muted" aria-hidden="true">
              <LogoutIcon />
            </span>
            <span>{isPending ? logoutPendingLabel : logoutLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ displayName }: { displayName: string | null }) {
  const initials = computeInitials(displayName);
  if (!initials) {
    // Fallback: círculo neutro con ícono genérico — no exponemos un emoji ni
    // texto si no tenemos nombre (defensive: el caso "displayName null" no
    // debería pasar en V1 — la stored function lo cubre con defensive null —
    // pero el componente lo absorbe sin romper).
    return (
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }
  return <span className="text-sm font-medium">{initials}</span>;
}
