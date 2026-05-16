import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Navegación locale-aware (Link/redirect/usePathname) para el LangSwitcher.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
