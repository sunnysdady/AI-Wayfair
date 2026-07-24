import assert from "node:assert/strict";
import test from "node:test";

import { createPostgresD1Database } from "../lib/postgres-d1.mjs";
import { getRuntimeBindings } from "../lib/runtime-bindings.mjs";
import { createS3Files } from "../lib/s3-files.mjs";

test("translates D1 placeholders and preserves D1 result shapes", async () => {
  const calls = [];
  const pool = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [{ id: "one" }], rowCount: 1 };
    },
  };
  const db = createPostgresD1Database({ pool });

  const result = await db
    .prepare("SELECT id FROM records WHERE owner=? AND status IN (?,?)")
    .bind("ops", "open", "waiting")
    .all();

  assert.equal(
    calls[0].text,
    "SELECT id FROM records WHERE owner=$1 AND status IN ($2,$3)",
  );
  assert.deepEqual(calls[0].values, ["ops", "open", "waiting"]);
  assert.deepEqual(result, { results: [{ id: "one" }], success: true });
});

test("runs D1 batches atomically on one PostgreSQL client", async () => {
  const calls = [];
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      return { rows: [], rowCount: 1 };
    },
    release() {
      calls.push({ text: "RELEASE" });
    },
  };
  const pool = { async connect() { return client; } };
  const db = createPostgresD1Database({ pool });

  await db.batch([
    db.prepare("DELETE FROM order_items WHERE po_number=?").bind("PO-1"),
    db.prepare("INSERT INTO order_items(po_number,line_key) VALUES(?,?)").bind("PO-1", "1"),
  ]);

  assert.deepEqual(calls.map((call) => call.text), [
    "BEGIN",
    "DELETE FROM order_items WHERE po_number=$1",
    "INSERT INTO order_items(po_number,line_key) VALUES($1,$2)",
    "COMMIT",
    "RELEASE",
  ]);
});

test("creates standalone bindings when DATABASE_URL is configured", async () => {
  const database = { prepare() {} };
  const files = { get() {} };
  const env = await getRuntimeBindings({
    processEnv: {
      DATABASE_URL: "postgres://example.invalid/database",
      S3_BUCKET: "reports",
      S3_ACCESS_KEY_ID: "test-key",
      S3_SECRET_ACCESS_KEY: "test-secret",
    },
    createDatabase: () => database,
    createFiles: () => files,
  });

  assert.equal(env.RUNTIME_PLATFORM, "node");
  assert.equal(env.DB, database);
  assert.equal(env.FILES, files);
});

test("maps R2-compatible file operations to S3 commands", async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command);
      if (command.constructor.name === "GetObjectCommand") {
        return {
          Body: {
            async transformToByteArray() {
              return new TextEncoder().encode("report");
            },
          },
          ContentType: "text/html",
        };
      }
      return {};
    },
  };
  const files = createS3Files({
    client,
    bucket: "reports",
    commands: {
      PutObjectCommand: class PutObjectCommand { constructor(input) { this.input = input; } },
      GetObjectCommand: class GetObjectCommand { constructor(input) { this.input = input; } },
      DeleteObjectCommand: class DeleteObjectCommand { constructor(input) { this.input = input; } },
    },
  });

  await files.put("reports/one.html", "report", {
    httpMetadata: { contentType: "text/html" },
  });
  const object = await files.get("reports/one.html");
  await files.delete("reports/one.html");

  assert.deepEqual(commands.map((command) => command.constructor.name), [
    "PutObjectCommand",
    "GetObjectCommand",
    "DeleteObjectCommand",
  ]);
  assert.equal(commands[0].input.Bucket, "reports");
  assert.equal(commands[0].input.ContentType, "text/html");
  assert.equal(await new Response(object.body).text(), "report");
  assert.equal(object.httpMetadata.contentType, "text/html");
});
