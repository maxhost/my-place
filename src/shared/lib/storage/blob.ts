import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { log } from "@/shared/lib/observability/log";

import type {
  BlobBucket,
  DeleteBlobInput,
  GetBlobUrlInput,
  UploadBlobInput,
  UploadBlobResult,
} from "./types";

// Wrapper sobre `@aws-sdk/client-s3` v3 contra Cloudflare R2 S3-compatible
// (ADR-0048, Phase 1.G). API pública minimal: `uploadBlob` + `getBlobUrl` +
// `deleteBlob`. Aísla los callsites (V1.3+) de la API del SDK — future eject
// a AWS S3 / Backblaze B2 / MinIO toca SOLO este archivo (S3-compatible),
// los consumers no se enteran.
//
// ## Behavior por entorno (mismo patrón que rate-limit Phase 0.D)
//
// - **Production (`NODE_ENV === "production"`) sin creds R2** → throw al
//   primer call de cualquier operación. NO permitimos uploads silenciosos
//   sin storage configurado. La crash bloquea el flow → operador NOTA + setea
//   creds + retry.
// - **Dev/local sin creds** → `ensureConfig` retorna "skipped" + log.warn 1×.
//   CADA call de upload/get/delete throwsa con mensaje claro indicando setear
//   `.env.local`. Local sigue levantando sin R2 account (developer ergonomics)
//   pero las operaciones storage NO pueden mockearse silenciosamente — esto
//   evita que un dev assume que "uploadeó algo" cuando no se guardó nada.
//
// ## Singleton + lazy init
//
// `S3Client` mantiene un connection pool interno; crear uno por request mata
// el cold-start. Lazy init en el primer call + cache en módulo-scope. El
// cliente es 1, compartido entre operaciones de `public` y `private` buckets
// (R2 multiplexa por bucket name en el Bucket field del command).
//
// ## R2-specific config
//
// - `region: "auto"` — R2 NO tiene regiones (one global edge). El SDK exige
//   un region string; "auto" es el valor canónico de Cloudflare.
// - `endpoint: https://{accountId}.r2.cloudflarestorage.com` — endpoint R2
//   S3-compatible. Per-account, no per-bucket.
// - `forcePathStyle: true` — R2 acepta tanto virtual-hosted como path-style;
//   path es más portable (compatible con MinIO / Backblaze sin cambios).
//
// ## URLs públicas vs privadas
//
// - Bucket `public` → URL directa `${R2_PUBLIC_BASE_URL}/${key}`. El custom
//   domain (`media.place.community` por convención) sirve por Cloudflare CDN
//   con cache headers default del bucket. No-op para `getBlobUrl(public)`
//   (mismo URL siempre).
// - Bucket `private` → presigned URL via `@aws-sdk/s3-request-presigner` con
//   TTL configurable (default 1h). La URL incluye signature query params; al
//   expirar Cloudflare rechaza la request. El caller decide TTL según UX:
//   "1h" para imágenes en page-load, "24h" para downloads diferidos, etc.
//
// ## Defense-in-depth
//
// Los errores del SDK S3 bubble up sin swallow — el caller decide retry /
// surface / log. El módulo NO captura `NoSuchKey` ni similares como "no es un
// error" porque el contrato semántico depende del consumer (delete de algo
// inexistente puede ser idempotent en un caller y bug en otro).

const ACCOUNT_ID_ENV = "R2_ACCOUNT_ID";
const ACCESS_KEY_ENV = "R2_ACCESS_KEY_ID";
const SECRET_KEY_ENV = "R2_SECRET_ACCESS_KEY";
const PUBLIC_BUCKET_ENV = "R2_PUBLIC_BUCKET";
const PRIVATE_BUCKET_ENV = "R2_PRIVATE_BUCKET";
const PUBLIC_BASE_URL_ENV = "R2_PUBLIC_BASE_URL";

const DEFAULT_TTL_SECONDS = 3600;

type StorageConfig = {
  client: S3Client;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
};

let configCache: StorageConfig | "skipped" | null = null;

function ensureConfig(): StorageConfig | "skipped" {
  if (configCache !== null) return configCache;

  const accountId = process.env[ACCOUNT_ID_ENV];
  const accessKey = process.env[ACCESS_KEY_ENV];
  const secretKey = process.env[SECRET_KEY_ENV];
  const publicBucket = process.env[PUBLIC_BUCKET_ENV];
  const privateBucket = process.env[PRIVATE_BUCKET_ENV];
  const publicBaseUrl = process.env[PUBLIC_BASE_URL_ENV];
  const isProd = process.env.NODE_ENV === "production";

  const missing: string[] = [];
  if (accountId === undefined || accountId === "") missing.push(ACCOUNT_ID_ENV);
  if (accessKey === undefined || accessKey === "") missing.push(ACCESS_KEY_ENV);
  if (secretKey === undefined || secretKey === "") missing.push(SECRET_KEY_ENV);
  if (publicBucket === undefined || publicBucket === "")
    missing.push(PUBLIC_BUCKET_ENV);
  if (privateBucket === undefined || privateBucket === "")
    missing.push(PRIVATE_BUCKET_ENV);
  if (publicBaseUrl === undefined || publicBaseUrl === "")
    missing.push(PUBLIC_BASE_URL_ENV);

  if (missing.length > 0) {
    if (isProd) {
      throw new Error(
        `[storage] Missing ${missing.join(", ")} in production. ` +
          `Storage operations cannot be performed without R2 credentials. ` +
          `Configure them in Vercel env vars (Production + Preview scopes). ` +
          `See docs/stack.md §"Variables de entorno" + ADR-0048.`,
      );
    }
    log.warn(
      { scope: "storage", missing },
      `R2 env vars missing (${missing.join(", ")}) — storage operations will throw if attempted. ` +
        `Set them in .env.local to test storage locally.`,
    );
    configCache = "skipped";
    return configCache;
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKey as string,
      secretAccessKey: secretKey as string,
    },
    forcePathStyle: true,
  });

  configCache = {
    client,
    publicBucket: publicBucket as string,
    privateBucket: privateBucket as string,
    publicBaseUrl: (publicBaseUrl as string).replace(/\/$/, ""),
  };
  return configCache;
}

function resolveBucket(bucket: BlobBucket, cfg: StorageConfig): string {
  return bucket === "public" ? cfg.publicBucket : cfg.privateBucket;
}

function requireConfig(op: string): StorageConfig {
  const cfg = ensureConfig();
  if (cfg === "skipped") {
    throw new Error(
      `[storage] ${op} attempted without R2 credentials (dev mode). ` +
        `Set R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + ` +
        `R2_PUBLIC_BUCKET + R2_PRIVATE_BUCKET + R2_PUBLIC_BASE_URL in .env.local ` +
        `to exercise this path locally.`,
    );
  }
  return cfg;
}

/**
 * Sube un blob al bucket indicado. Retorna `{key}` siempre; `publicUrl`
 * SOLO si `bucket === "public"`. El caller persiste `key` en DB (URL
 * persistente sólo cuando público); para bucket privado se reconstruye con
 * `getBlobUrl` cada vez que se necesita servir.
 *
 * **NO valida** tamaño/mime — cada consumer V1.3+ pone sus propias guard
 * rails (logo place: max 2MB png/jpg/webp; avatar: max 1MB; library: TBD).
 */
export async function uploadBlob(
  input: UploadBlobInput,
): Promise<UploadBlobResult> {
  const cfg = requireConfig("uploadBlob");
  const bucket = resolveBucket(input.bucket, cfg);
  await cfg.client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body as PutObjectCommand["input"]["Body"],
      ContentType: input.contentType,
    }),
  );
  const result: UploadBlobResult = { key: input.key };
  if (input.bucket === "public") {
    result.publicUrl = `${cfg.publicBaseUrl}/${input.key}`;
  }
  return result;
}

/**
 * Resuelve la URL para servir un blob:
 *  - `bucket === "public"`: URL directa `${R2_PUBLIC_BASE_URL}/${key}` (no
 *    consulta red, sólo string concatenation). El caller puede cachear sin
 *    miedo — la URL no caduca.
 *  - `bucket === "private"`: presigned URL via S3 SigV4 con TTL `ttlSeconds`
 *    (default 1h). La URL es válida sólo durante la ventana — al expirar
 *    Cloudflare rechaza. El caller decide TTL según UX.
 */
export async function getBlobUrl(input: GetBlobUrlInput): Promise<string> {
  const cfg = requireConfig("getBlobUrl");
  if (input.bucket === "public") {
    return `${cfg.publicBaseUrl}/${input.key}`;
  }
  const command = new GetObjectCommand({
    Bucket: cfg.privateBucket,
    Key: input.key,
  });
  return getSignedUrl(cfg.client, command, {
    expiresIn: input.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });
}

/**
 * Borra un blob. Si la key no existe, R2 retorna éxito silencioso (S3
 * standard behavior). Si el caller necesita confirmación de existence-then-
 * delete, debe hacer `HEAD` previo (no expuesto en V1).
 */
export async function deleteBlob(input: DeleteBlobInput): Promise<void> {
  const cfg = requireConfig("deleteBlob");
  const bucket = resolveBucket(input.bucket, cfg);
  await cfg.client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: input.key }),
  );
}

/**
 * Reset de cache — sólo para tests, que necesitan re-inicializar entre cases
 * con distinto env. NO usar en código de producción.
 */
export function _resetConfigCacheForTests(): void {
  configCache = null;
}

export type {
  BlobBucket,
  DeleteBlobInput,
  GetBlobUrlInput,
  UploadBlobBody,
  UploadBlobInput,
  UploadBlobResult,
} from "./types";
