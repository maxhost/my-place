import type { ReactNode } from "react";
import { AppShellAccountMenu } from "./app-shell-account-menu";
import { AppShellDrawer } from "./app-shell-drawer";
import type {
  AppShellLabels,
  SidebarGroup,
  SidebarItem,
} from "./app-shell-labels";

// Shell agnóstico mobile-first (ADR-0023). Composer Server: topbar arriba
// (con drawer Client en mobile + account menu Client a la derecha) +
// sidebar fija a la izquierda en desktop + `<main>` con `children`.
// Consumers V1: `nav-hub` (Hub) y `nav-place` (settings, S5).
//
// V1.1 del sidebar (ADR-0025): el shell acepta `sidebarGroups: SidebarGroup[]`
// (no `sidebarItems` flat). Cada grupo puede tener `label: null` (modo plano,
// usado por `nav-hub` V1) o `label: string` (header fijo no-colapsable, usado
// por `nav-place` V1.1 para sus 4 zonas conceptuales). Reglas de render
// canónicas viven en el JSDoc de `SidebarGroup` (app-shell-labels.ts).
//
// El componente NO importa de `src/features/` — primitivo UI agnóstico al
// dominio. Verificable: `grep -rn 'from "@/features/' src/shared/` → vacío.
// Si esa regla se rompe, el refactor está mal hecho (`docs/architecture.md`
// §"Reglas de aislamiento entre módulos"). El test del shell la documenta
// como invariante semántica del módulo.
//
// Server Component compose-de-todo: el drawer y el account menu son
// "use client" porque manejan state (toggle del drawer, dropdown del
// account). El shell pasa Server JSX (`<sidebar>`) como `children` al
// drawer Client — patrón canónico de Next App Router (Client puede
// recibir Server como children sin perder SSR del subtree estable).
//
// Mobile-first: estructura base es columnar (topbar + main); en md+ se
// mete la sidebar fija a la izquierda (`hidden md:block`). La sidebar se
// "duplica" en el JSX (desktop `<aside>` + drawer mobile la renderea
// dentro), pero las dos instancias nunca son visibles a la vez — la
// desktop está `hidden` en <md y el drawer está `md:hidden` en md+.

type LogoutResult = { redirectTo: string };

type Props = {
  /** Texto del header (también aria-label del drawer dialog). */
  title: string;
  /**
   * Grupos del sidebar (ADR-0025). Cada grupo es `{ label, items }`:
   * `label: null` → modo plano sin header; `label: string` → `<h2>` fijo
   * arriba de los items (no-colapsable). Ver JSDoc de `SidebarGroup`.
   */
  sidebarGroups: SidebarGroup[];
  /** Key del item activo (matchea contra el `.key` de algún item de algún grupo). */
  activeKey: string;
  /** Para el avatar del account menu. */
  displayName: string | null;
  /** Server Action bound por el consumer. Retorna `{redirectTo}`. */
  onLogout: () => Promise<LogoutResult>;
  labels: AppShellLabels;
  /** Navegación post-logout. Default: `window.location.assign`. */
  navigate?: (url: string) => void;
  children: ReactNode;
};

export function AppShell({
  title,
  sidebarGroups,
  activeKey,
  displayName,
  onLogout,
  navigate,
  labels,
  children,
}: Props) {
  const sidebar = (
    <AppShellSidebarNav
      groups={sidebarGroups}
      activeKey={activeKey}
      ariaLabel={title}
      comingSoon={labels.comingSoon}
    />
  );
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-3 md:px-6">
        <div className="md:hidden">
          <AppShellDrawer
            openLabel={labels.openMenu}
            closeLabel={labels.closeMenu}
            dialogLabel={title}
          >
            {sidebar}
          </AppShellDrawer>
        </div>
        <div className="font-medium text-ink">{title}</div>
        <div className="ml-auto">
          <AppShellAccountMenu
            triggerLabel={labels.accountMenuButton}
            logoutLabel={labels.accountMenuLogout}
            logoutPendingLabel={labels.accountMenuLogoutPending}
            displayName={displayName}
            onLogout={onLogout}
            navigate={navigate}
          />
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden md:block md:w-64 shrink-0 border-r border-border bg-surface">
          {sidebar}
        </aside>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

// Sidebar nav puro presentacional. Server (sin hooks). Vive inline acá
// porque (a) es trivial, (b) sólo lo usa `AppShell`, (c) extraerlo agregaría
// 1 archivo sin valor reusable más allá del shell.
//
// Estructura V1.1 (ADR-0025): itera sobre `SidebarGroup[]`. Por cada grupo
// renderea (a) un `<h2>` fijo si `group.label !== null`, (b) los items del
// grupo aplicando las render rules de cada `SidebarItem` (activo / disabled /
// regular). El heading vive dentro del `<nav>` — es sub-sección semántica,
// NO disclosure widget (sin role button, sin aria-expanded).
function AppShellSidebarNav({
  groups,
  activeKey,
  ariaLabel,
  comingSoon,
}: {
  groups: SidebarGroup[];
  activeKey: string;
  ariaLabel: string;
  comingSoon: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="flex flex-col gap-1 p-3">
      {groups.map((group, groupIndex) => (
        <div
          key={group.label ?? `__plain-${groupIndex}`}
          className="flex flex-col gap-1"
        >
          {group.label !== null ? (
            <h2 className="px-3 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {group.label}
            </h2>
          ) : null}
          {group.items.map((item) => renderSidebarItem(item, activeKey, comingSoon))}
        </div>
      ))}
    </nav>
  );
}

// Render rules de cada item (ADR-0023 §SidebarItem). Se extrajo de
// `AppShellSidebarNav` porque ahora se invoca dentro del loop de grupos —
// inline crecía el inner-map y oscurecía la estructura del grupo.
function renderSidebarItem(
  item: SidebarItem,
  activeKey: string,
  comingSoon: string,
) {
  // Disabled gana sobre href/active — invariante de runtime documentada
  // en `app-shell-labels.ts` §SidebarItem (render rules).
  if (item.disabled) {
    return (
      <span
        key={item.key}
        aria-disabled="true"
        title={comingSoon}
        className="flex items-center gap-3 rounded-md px-3 py-2 min-h-11 text-muted cursor-not-allowed"
      >
        {item.icon ? (
          <span className="shrink-0" aria-hidden="true">
            {item.icon}
          </span>
        ) : null}
        <span>{item.label}</span>
      </span>
    );
  }
  const isActive = item.key === activeKey;
  return (
    <a
      key={item.key}
      href={item.href}
      aria-current={isActive ? "page" : undefined}
      className={[
        "flex items-center gap-3 rounded-md px-3 py-2 min-h-11",
        "text-ink hover:bg-bg",
        isActive ? "bg-bg font-medium" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {item.icon ? (
        <span className="shrink-0 text-muted" aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span>{item.label}</span>
    </a>
  );
}
