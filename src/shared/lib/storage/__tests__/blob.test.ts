import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests del wrapper storage (`uploadBlob` / `getBlobUrl` / `deleteBlob`) con
// mocks de `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. NO hace
// network calls — todo in-memory.
//
// Cobertura:
//   - Skip en dev sin creds (warn loggeado) — operaciones throwsean con msg claro.
//   - Throw en prod sin creds (fail-loud-prod).
//   - uploadBlob bucket="public" → PutObjectCommand correcto + publicUrl en
//     resultado.
//   - uploadBlob bucket="private" → PutObjectCommand correcto + NO publicUrl.
//   - getBlobUrl bucket="public" → URL directa, NO llama presigner.
//   - getBlobUrl bucket="private" → presigned URL via getSignedUrl con TTL
//     default + custom.
//   - deleteBlob → DeleteObjectCommand al bucket correcto.
//   - Singleton: ensureConfig NO re-construye S3Client entre calls.
//   - publicBaseUrl con trailing slash → normalizado (sin doble slash).

const sendMock = vi.fn();
const S3ClientCtor = vi.fn();
const PutObjectCommandCtor = vi.fn();
const GetObjectCommandCtor = vi.fn();
const DeleteObjectCommandCtor = vi.fn();
const getSignedUrlMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  function MockS3Client(this: { send: typeof sendMock }, opts: unknown) {
    S3ClientCtor(opts);
    this.send = sendMock;
  }
  function MockPutObjectCommand(opts: unknown) {
    PutObjectCommandCtor(opts);
    return { _kind: "PutObjectCommand", opts };
  }
  function MockGetObjectCommand(opts: unknown) {
    GetObjectCommandCtor(opts);
    return { _kind: "GetObjectCommand", opts };
  }
  function MockDeleteObjectCommand(opts: unknown) {
    DeleteObjectCommandCtor(opts);
    return { _kind: "DeleteObjectCommand", opts };
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

async function loadModule() {
  return await import("../blob");
}

const ORIGINAL_ENV = { ...process.env };

const FULL_CREDS = {
  R2_ACCOUNT_ID: "acc-abc-123",
  R2_ACCESS_KEY_ID: "AKIA-test",
  R2_SECRET_ACCESS_KEY: "secret-test",
  R2_PUBLIC_BUCKET: "place-media-public",
  R2_PRIVATE_BUCKET: "place-media-private",
  R2_PUBLIC_BASE_URL: "https://media.place.community",
};

function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
}

beforeEach(() => {
  vi.resetModules();
  sendMock.mockReset();
  S3ClientCtor.mockReset();
  PutObjectCommandCtor.mockReset();
  GetObjectCommandCtor.mockReset();
  DeleteObjectCommandCtor.mockReset();
  getSignedUrlMock.mockReset();
  const env = process.env as Record<string, string | undefined>;
  delete env.R2_ACCOUNT_ID;
  delete env.R2_ACCESS_KEY_ID;
  delete env.R2_SECRET_ACCESS_KEY;
  delete env.R2_PUBLIC_BUCKET;
  delete env.R2_PRIVATE_BUCKET;
  delete env.R2_PUBLIC_BASE_URL;
  delete env.NODE_ENV;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("storage — dev sin creds", () => {
  it("uploadBlob throws con mensaje claro + warn al primer call", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await loadModule();
    await expect(
      mod.uploadBlob({
        bucket: "public",
        key: "place/abc/logo.png",
        body: Buffer.from("hi"),
        contentType: "image/png",
      }),
    ).rejects.toThrow(/uploadBlob attempted without R2 credentials/);

    expect(S3ClientCtor).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("storage");

    warnSpy.mockRestore();
  });

  it("warn loggeado UNA SOLA vez aunque se llame múltiple", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await loadModule();
    await expect(
      mod.uploadBlob({
        bucket: "public",
        key: "k1",
        body: "x",
        contentType: "text/plain",
      }),
    ).rejects.toThrow();
    await expect(
      mod.getBlobUrl({ bucket: "public", key: "k2" }),
    ).rejects.toThrow();
    await expect(
      mod.deleteBlob({ bucket: "private", key: "k3" }),
    ).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("getBlobUrl + deleteBlob también throwsean con su nombre en el msg", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const mod = await loadModule();
    await expect(
      mod.getBlobUrl({ bucket: "public", key: "k" }),
    ).rejects.toThrow(/getBlobUrl attempted without R2 credentials/);
    await expect(
      mod.deleteBlob({ bucket: "public", key: "k" }),
    ).rejects.toThrow(/deleteBlob attempted without R2 credentials/);
  });
});

describe("storage — prod sin creds", () => {
  it("throw al primer call con mensaje listando TODAS las missing vars", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";

    const mod = await loadModule();
    await expect(
      mod.uploadBlob({
        bucket: "public",
        key: "k",
        body: "x",
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/Missing R2_ACCOUNT_ID[\s\S]*R2_PUBLIC_BASE_URL/);
  });

  it("throw cuando sólo falta UN var (lista solo el missing)", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    setEnv(FULL_CREDS);
    delete process.env.R2_PUBLIC_BASE_URL;

    const mod = await loadModule();
    await expect(
      mod.uploadBlob({
        bucket: "public",
        key: "k",
        body: "x",
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/Missing R2_PUBLIC_BASE_URL/);
  });
});

describe("storage — con creds (uploadBlob)", () => {
  beforeEach(() => {
    setEnv(FULL_CREDS);
    sendMock.mockResolvedValue({});
  });

  it("public bucket → PutObjectCommand a R2_PUBLIC_BUCKET + retorna publicUrl", async () => {
    const mod = await loadModule();
    const result = await mod.uploadBlob({
      bucket: "public",
      key: "place/abc-123/logo.png",
      body: Buffer.from("png-bytes"),
      contentType: "image/png",
    });

    expect(PutObjectCommandCtor).toHaveBeenCalledWith({
      Bucket: "place-media-public",
      Key: "place/abc-123/logo.png",
      Body: Buffer.from("png-bytes"),
      ContentType: "image/png",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      key: "place/abc-123/logo.png",
      publicUrl: "https://media.place.community/place/abc-123/logo.png",
    });
  });

  it("private bucket → PutObjectCommand a R2_PRIVATE_BUCKET + SIN publicUrl", async () => {
    const mod = await loadModule();
    const result = await mod.uploadBlob({
      bucket: "private",
      key: "place/abc-123/library/doc.pdf",
      body: Buffer.from("pdf-bytes"),
      contentType: "application/pdf",
    });

    expect(PutObjectCommandCtor).toHaveBeenCalledWith({
      Bucket: "place-media-private",
      Key: "place/abc-123/library/doc.pdf",
      Body: Buffer.from("pdf-bytes"),
      ContentType: "application/pdf",
    });
    expect(result).toEqual({ key: "place/abc-123/library/doc.pdf" });
    expect(result.publicUrl).toBeUndefined();
  });

  it("publicBaseUrl con trailing slash → normalizado en publicUrl", async () => {
    setEnv({ R2_PUBLIC_BASE_URL: "https://media.place.community/" });
    const mod = await loadModule();
    const result = await mod.uploadBlob({
      bucket: "public",
      key: "logo.png",
      body: "x",
      contentType: "image/png",
    });
    expect(result.publicUrl).toBe("https://media.place.community/logo.png");
  });

  it("S3Client se construye 1 sola vez (singleton across calls)", async () => {
    const mod = await loadModule();
    await mod.uploadBlob({
      bucket: "public",
      key: "k1",
      body: "x",
      contentType: "text/plain",
    });
    await mod.uploadBlob({
      bucket: "private",
      key: "k2",
      body: "x",
      contentType: "text/plain",
    });
    await mod.deleteBlob({ bucket: "public", key: "k1" });

    expect(S3ClientCtor).toHaveBeenCalledTimes(1);
    expect(S3ClientCtor).toHaveBeenCalledWith({
      region: "auto",
      endpoint: "https://acc-abc-123.r2.cloudflarestorage.com",
      credentials: {
        accessKeyId: "AKIA-test",
        secretAccessKey: "secret-test",
      },
      forcePathStyle: true,
    });
  });
});

describe("storage — getBlobUrl", () => {
  beforeEach(() => {
    setEnv(FULL_CREDS);
  });

  it("public bucket → URL directa, NO llama presigner", async () => {
    const mod = await loadModule();
    const url = await mod.getBlobUrl({
      bucket: "public",
      key: "place/x/avatar.jpg",
    });
    expect(url).toBe("https://media.place.community/place/x/avatar.jpg");
    expect(getSignedUrlMock).not.toHaveBeenCalled();
    expect(GetObjectCommandCtor).not.toHaveBeenCalled();
  });

  it("private bucket → presigned URL via getSignedUrl con TTL default 3600", async () => {
    getSignedUrlMock.mockResolvedValue("https://signed.example.com/x?sig=abc");

    const mod = await loadModule();
    const url = await mod.getBlobUrl({
      bucket: "private",
      key: "place/x/library/doc.pdf",
    });

    expect(GetObjectCommandCtor).toHaveBeenCalledWith({
      Bucket: "place-media-private",
      Key: "place/x/library/doc.pdf",
    });
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    expect(getSignedUrlMock.mock.calls[0]?.[2]).toEqual({ expiresIn: 3600 });
    expect(url).toBe("https://signed.example.com/x?sig=abc");
  });

  it("private bucket con ttlSeconds custom → propagado al presigner", async () => {
    getSignedUrlMock.mockResolvedValue("https://signed.example.com/x?sig=abc");

    const mod = await loadModule();
    await mod.getBlobUrl({
      bucket: "private",
      key: "k",
      ttlSeconds: 86400,
    });

    expect(getSignedUrlMock.mock.calls[0]?.[2]).toEqual({ expiresIn: 86400 });
  });
});

describe("storage — deleteBlob", () => {
  beforeEach(() => {
    setEnv(FULL_CREDS);
    sendMock.mockResolvedValue({});
  });

  it("public bucket → DeleteObjectCommand al R2_PUBLIC_BUCKET", async () => {
    const mod = await loadModule();
    await mod.deleteBlob({ bucket: "public", key: "logo.png" });

    expect(DeleteObjectCommandCtor).toHaveBeenCalledWith({
      Bucket: "place-media-public",
      Key: "logo.png",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("private bucket → DeleteObjectCommand al R2_PRIVATE_BUCKET", async () => {
    const mod = await loadModule();
    await mod.deleteBlob({ bucket: "private", key: "doc.pdf" });

    expect(DeleteObjectCommandCtor).toHaveBeenCalledWith({
      Bucket: "place-media-private",
      Key: "doc.pdf",
    });
  });

  it("bubble up error del SDK (no swallow)", async () => {
    sendMock.mockRejectedValue(new Error("AccessDenied"));

    const mod = await loadModule();
    await expect(
      mod.deleteBlob({ bucket: "public", key: "k" }),
    ).rejects.toThrow(/AccessDenied/);
  });
});
