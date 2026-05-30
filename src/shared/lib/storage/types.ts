// SoT de tipos del módulo `storage/` (Phase 1.G — wrapper sobre
// `@aws-sdk/client-s3` v3 contra Cloudflare R2 S3-compatible). El módulo
// expone una API minimal estable: `uploadBlob` + `getBlobUrl` + `deleteBlob`.
//
// ## Modelo de 2 buckets (decisión ADR-0048)
//
// Provisionamos 2 buckets desde el día 1:
//   - **public** (`R2_PUBLIC_BUCKET`, e.g. `place-media-public`) — logos del
//     place + avatares de miembros. Servidos via custom domain CDN-cacheado
//     (`media.place.community`). URLs directas sin signing — el contenido es
//     público por design del producto (ontologia/miembros.md "avatar … en
//     todas partes"; ADR-0046 §ε place logo).
//   - **private** (`R2_PRIVATE_BUCKET`, e.g. `place-media-private`) —
//     library docs + event photos + cualquier asset auth-gated futuro. Lectura
//     vía presigned URLs TTL-limited (default 1h). El bucket nunca expone hash
//     R2 en URLs internas — la auth-gate viene del Server Action que emite el
//     presigned URL.
//
// El lifecycle/policy difieren entre los 2 buckets: el privado puede tener
// retention rules (e.g. event photos auto-archive después N años) sin afectar
// al público. Separación física justifica la pequeña duplicación del API.
//
// ## UploadBlobInput.body
//
// Acepta los tipos que el SDK AWS S3 v3 permite directamente (Buffer / Blob /
// ReadableStream / Uint8Array / string). El caller decide el shape según
// origen (Server Action recibe `File`, lookup desde URL trae `ReadableStream`,
// etc.). El wrapper NO valida tamaño/mime — esa policy vive en cada consumer
// (Phase 1.G no define consumers; los V1.3+ ponen sus propias guard rails).
//
// ## UploadBlobResult.publicUrl
//
// Sólo presente cuando `bucket === "public"`. El URL es construido como
// `${R2_PUBLIC_BASE_URL}/${key}` — cacheable, estable, browser-fetchable
// directo. Para bucket privado el caller llama `getBlobUrl` cuando necesita
// servir el asset (la URL caduca, no se persiste en DB).

export type BlobBucket = "public" | "private";

export type UploadBlobBody =
  | Buffer
  | Blob
  | Uint8Array
  | string
  | ReadableStream;

export type UploadBlobInput = {
  bucket: BlobBucket;
  /** Object key dentro del bucket. Convención: `place/{placeId}/{kind}/{filename}`. */
  key: string;
  body: UploadBlobBody;
  /** MIME type (e.g. `image/png`). Persiste como Content-Type response header. */
  contentType: string;
};

export type UploadBlobResult = {
  /** El key tal cual fue uploadeado (echo del input — useful en pipelines). */
  key: string;
  /** Sólo presente si `bucket === "public"`. URL directa CDN-cacheada. */
  publicUrl?: string;
};

export type GetBlobUrlInput = {
  bucket: BlobBucket;
  key: string;
  /** Sólo aplica a `bucket === "private"`. Default 3600s (1h). */
  ttlSeconds?: number;
};

export type DeleteBlobInput = {
  bucket: BlobBucket;
  key: string;
};
