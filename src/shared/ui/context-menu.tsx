"use client";

import { useEffect, useRef, useState } from "react";

// Dropdown menu genérico activable por un trigger. Patrón extraído del
// inline de `app-shell/app-shell-account-menu.tsx:80-115` para que Feature E
// (members slice) consuma menús por-fila sin duplicar el behavior. El
// consumer original NO se refactorea en V1 (evita scope creep S5).
//
// Por qué `mousedown` para click-outside (no `click`): cerrar antes de que
// el target afuera dispare su propio `onClick` evita disparos accidentales
// en otros botones/links del DOM. Mismo trade-off que el precedente.
//
// `destructive: true` aplica una clase utilitaria local
// (`context-menu-item--destructive`) — no hay token `--danger`/`--destructive`
// en el design system (ver `src/app/globals.css` §"Status tones"); el hook
// semántico permite mapear un color cuando se agregue, sin tocar consumers.

export type ContextMenuItem = {
  key: string;
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
};

type ContextMenuProps = {
  triggerLabel: string;
  trigger: React.ReactNode;
  items: ContextMenuItem[];
};

export function ContextMenu({
  triggerLabel,
  trigger,
  items,
}: ContextMenuProps) {
  const [isOpen, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  function handleItemClick(item: ContextMenuItem) {
    if (item.disabled) return;
    item.onClick();
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-bg text-ink hover:bg-border"
      >
        {trigger}
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-border bg-surface shadow-lg motion-safe:duration-150"
        >
          {items.map((item) => {
            const destructiveClass = item.destructive
              ? "context-menu-item--destructive text-[--accent-strong]"
              : "text-ink";
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                aria-disabled={item.disabled ? "true" : undefined}
                onClick={() => handleItemClick(item)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 min-h-11 text-left hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60 ${destructiveClass}`}
              >
                {item.icon && (
                  <span className="shrink-0 text-muted" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
