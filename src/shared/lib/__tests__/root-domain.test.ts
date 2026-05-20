import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rootDomain } from "../root-domain";

// `rootDomain()` deriva el host público del subdominio APP (`app.place.community`
// en prod) y se usa para construir URLs cross-subdomain: redirects del hub al
// apex, redirects del apex al hub, logout. El fallback `place.community` aplica
// si la env está mal seteada (defensivo — el build no debería romper por ello,
// el smoke en producción cierra el contract). Helper extraído de las 2 pages
// que lo duplicaban (`(marketing)/[locale]/crear/page.tsx` y `/login/page.tsx`)
// + consumer nuevo del slice `nav-hub` (logoutAction).

describe("rootDomain — host derivado de NEXT_PUBLIC_APP_URL", () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
    }
  });

  it("retorna el host del URL en env (producción)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://place.community";
    expect(rootDomain()).toBe("place.community");
  });

  it("strippea el path si lo hay (sólo el host)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://place.community/foo/bar";
    expect(rootDomain()).toBe("place.community");
  });

  it("preserva el puerto si el URL lo tiene (dev local)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(rootDomain()).toBe("localhost:3000");
  });

  it("fallback a 'place.community' si la env está ausente", () => {
    expect(rootDomain()).toBe("place.community");
  });

  it("fallback a 'place.community' si la env es un URL inválido", () => {
    process.env.NEXT_PUBLIC_APP_URL = "not-a-valid-url";
    expect(rootDomain()).toBe("place.community");
  });
});
