import { createPostgresDatabaseFromEnv } from "./postgres-d1.mjs";
import { createS3FilesFromEnv } from "./s3-files.mjs";

const unavailableDatabase = new Proxy({}, {
  get() {
    return () => {
      throw new Error("Persistent database is unavailable; configure DATABASE_URL.");
    };
  },
});

const unavailableFiles = new Proxy({}, {
  get() {
    return async () => {
      throw new Error("Object storage is unavailable; configure S3_BUCKET and credentials.");
    };
  },
});

function objectStorageConfigured(env) {
  const explicitCredentials = env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY;
  return Boolean(
    env.S3_BUCKET
    && (explicitCredentials || env.S3_USE_DEFAULT_CREDENTIAL_CHAIN === "true"),
  );
}

export async function getRuntimeBindings(
  options = {},
) {
  const processEnv = options.processEnv || process.env;
  const createDatabase = options.createDatabase || createPostgresDatabaseFromEnv;
  const createFiles = options.createFiles || createS3FilesFromEnv;
  return {
    ...processEnv,
    DB: processEnv.DATABASE_URL
      ? await createDatabase(processEnv)
      : unavailableDatabase,
    FILES: objectStorageConfigured(processEnv)
      ? await createFiles(processEnv)
      : unavailableFiles,
    RUNTIME_PLATFORM: "node",
  };
}
