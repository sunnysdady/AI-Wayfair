async function bodyBytes(body) {
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body && typeof body.arrayBuffer === "function") {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  return body;
}

export function createS3Files({ client, bucket, commands }) {
  if (!client || !bucket || !commands) throw new Error("S3 storage configuration is incomplete");
  const { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = commands;

  return {
    async put(key, body, options = {}) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await bodyBytes(body),
        ContentType: options.httpMetadata?.contentType,
      }));
    },

    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }));
        if (!result.Body) return null;
        const bytes = await result.Body.transformToByteArray();
        return {
          body: new Response(bytes).body,
          httpMetadata: { contentType: result.ContentType },
        };
      } catch (error) {
        const code = error?.name || error?.Code;
        if (code === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
    },
  };
}

export async function createS3FilesFromEnv(env = process.env) {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not configured");
  const explicitCredentials = env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY;
  if (!explicitCredentials && env.S3_USE_DEFAULT_CREDENTIAL_CHAIN !== "true") {
    throw new Error(
      "S3 credentials are not configured; set access keys or explicitly enable the default credential chain",
    );
  }
  const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: env.S3_REGION || "us-east-1",
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    credentials: explicitCredentials
      ? {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
  return createS3Files({
    client,
    bucket,
    commands: { PutObjectCommand, GetObjectCommand, DeleteObjectCommand },
  });
}
