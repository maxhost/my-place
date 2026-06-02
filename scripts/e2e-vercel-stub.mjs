// Stub HTTP de la Vercel Domains REST API para los E2E (Phase 2.B.1).
//
// POR QUÉ: el E2E de "register custom domain" ejercita el flujo completo
// owner → /settings/domain → vincular → pending → verified → remover. Los
// Server Actions (`registerCustomDomainAction`, `getCustomDomainStatus`)
// llaman a Vercel desde el server Node — Playwright (browser) no puede
// interceptar ese fetch. El wrapper `src/shared/lib/vercel/domains-shared.ts`
// lee `VERCEL_API_BASE_URL` (seam DI, default `api.vercel.com`); en los E2E
// se apunta a este stub local. No hay lógica de test en el código de negocio:
// el wrapper hace el mismo fetch, sólo cambia el host destino.
//
// MODELO DE ESTADO (modela la propagación DNS real, ADR-0029 V9+V6):
//   - Un dominio arranca SIN propagar → getDomainConfig (V6) reporta
//     `misconfigured:true` y getDomainStatus (V9) `verified:false` → la page
//     muestra PENDING con tabla DNS (records recomendados V6).
//   - El test llama `POST /__advance?domain=X` para simular "el DNS ya
//     propagó" → V6 `misconfigured:false` + V9 `verified:true` → en el reload
//     el lazy poll (`verified && !misconfigured`) hace UPDATE verified_at →
//     VERIFIED.
// Esto evita depender de cuántos renders server hace Next: el flip
// pending→verified es disparado explícitamente por el test, no por timing.
//
// El register NO verifica al instante aunque el action haga `revalidatePath`
// (que re-renderiza y corre el lazy poll): pre-advance V6 dice misconfigured
// y V9 dice not-verified → queda pending. Recién el `/__advance` + reload
// flipea a verified.
import { createServer } from "node:http";

const PORT = Number(process.env.E2E_VERCEL_STUB_PORT ?? 3010);

/** Dominios cuyo "DNS ya propagó" (V6 ok + V9 verified). Default: vacío. */
const propagated = new Set();

/** Lee el body JSON de la request (vacío → {}). */
function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Extrae el segmento `:domain` (URL-encoded) de un pathname dado su índice. */
function segment(pathname, index) {
  return decodeURIComponent(pathname.split("/")[index] ?? "");
}

const server = createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  // Health check (Playwright `webServer.url`).
  if (method === "GET" && (pathname === "/" || pathname === "/health")) {
    return send(res, 200, { ok: true, stub: "vercel-domains" });
  }

  // Control E2E-only: marca un dominio como "propagado" (DNS ya apunta).
  // El test lo llama entre el estado pending y el reload → fuerza el flip.
  if (method === "POST" && pathname === "/__advance") {
    const body = await readJson(req);
    const domain = url.searchParams.get("domain") ?? body.domain ?? "";
    if (domain) propagated.add(domain);
    return send(res, 200, { ok: true, propagated: [...propagated] });
  }

  // POST /v10/projects/:id/domains — alta. verified:false → el registro queda
  // pending (ownership challenge no completado aún).
  if (method === "POST" && /^\/v10\/projects\/[^/]+\/domains\/?$/.test(pathname)) {
    const body = await readJson(req);
    const name = typeof body.name === "string" ? body.name : "unknown.example.com";
    return send(res, 200, {
      name,
      verified: false,
      verification: [
        {
          type: "TXT",
          domain: `_vercel.${name}`,
          value: "vc-domain-verify=e2e-stub-challenge",
          reason: "pending_domain_verification",
        },
      ],
    });
  }

  // GET /v6/domains/:domain/config — config DNS dinámica. misconfigured =
  // !propagado: pre-advance true (DNS roto → pending con recommendedCNAME),
  // post-advance false (DNS OK → mitad del AND lógico ADR-0029).
  if (method === "GET" && /^\/v6\/domains\/[^/]+\/config\/?$/.test(pathname)) {
    const domain = segment(pathname, 3);
    return send(res, 200, {
      configuredBy: propagated.has(domain) ? "CNAME" : null,
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.com" }],
      misconfigured: !propagated.has(domain),
    });
  }

  // GET /v9/projects/:id/domains/:domain — ownership. verified = propagado.
  if (
    method === "GET" &&
    /^\/v9\/projects\/[^/]+\/domains\/[^/]+\/?$/.test(pathname)
  ) {
    const domain = segment(pathname, 5);
    return send(res, 200, { name: domain, verified: propagated.has(domain) });
  }

  // DELETE /v9/projects/:id/domains/:domain — archive best-effort.
  if (
    method === "DELETE" &&
    /^\/v9\/projects\/[^/]+\/domains\/[^/]+\/?$/.test(pathname)
  ) {
    const domain = segment(pathname, 5);
    propagated.delete(domain);
    return send(res, 200, {});
  }

  return send(res, 404, { error: "not_found", method, pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e] Vercel Domains stub escuchando en http://127.0.0.1:${PORT}`);
});

// Graceful shutdown cuando Playwright mata el proceso del webServer.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
