import assert from "node:assert/strict";
import test from "node:test";

import {
  handleLarkWebhook,
  isMentionedByBot,
  larkAesDecrypt,
  larkAesEncrypt,
  larkSha256Hex,
  parseLarkMessageEvent,
  verifyLarkSignature,
} from "../lib/lark-bot.mjs";

test("encrypts and decrypts callback payloads with the shared AES key", () => {
  const encryptKey = "test-encrypt-key";
  const plain = JSON.stringify({ challenge: "ajls384kdj1234", type: "url_verification" });

  const encrypted = larkAesEncrypt(encryptKey, plain);
  assert.notEqual(encrypted, plain);
  assert.deepEqual(JSON.parse(larkAesDecrypt(encryptKey, encrypted)), {
    challenge: "ajls384kdj1234",
    type: "url_verification",
  });
});

test("verifies the X-Lark-Signature over timestamp, nonce, key and raw body", () => {
  const encryptKey = "another-key";
  const timestamp = "1700000000000";
  const nonce = "abc123";
  const body = JSON.stringify({ encrypt: "payload" });
  const signature = larkSha256Hex(`${timestamp}${nonce}${encryptKey}${body}`);

  assert.equal(
    verifyLarkSignature(encryptKey, timestamp, nonce, body, signature),
    true,
  );
  assert.equal(
    verifyLarkSignature(encryptKey, timestamp, nonce, body, signature + "x"),
    false,
  );
  assert.equal(
    verifyLarkSignature("wrong-key", timestamp, nonce, body, signature),
    false,
  );
});

test("answers the URL verification challenge in plaintext mode", async () => {
  const response = await handleLarkWebhook(
    JSON.stringify({ challenge: "1b6aef1a", token: "vtok", type: "url_verification" }),
    { LARK_VERIFICATION_TOKEN: "vtok" },
    {},
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "1b6aef1a" });
});

test("rejects a URL verification request with a mismatched token", async () => {
  const response = await handleLarkWebhook(
    JSON.stringify({ challenge: "1b6aef1a", token: "wrong", type: "url_verification" }),
    { LARK_VERIFICATION_TOKEN: "vtok" },
    {},
  );

  assert.equal(response.status, 401);
});

test("decrypts and answers the URL verification challenge in encrypted mode", async () => {
  const encryptKey = "enc-key";
  const token = "vtok";
  const plain = JSON.stringify({ challenge: "challenge-42", token, type: "url_verification" });
  const rawBody = JSON.stringify({ encrypt: larkAesEncrypt(encryptKey, plain) });
  const signature = larkSha256Hex(`1700000000000nonce${encryptKey}${rawBody}`);

  const response = await handleLarkWebhook(rawBody, {
    LARK_ENCRYPT_KEY: encryptKey,
    LARK_VERIFICATION_TOKEN: token,
  }, {
    headers: {
      "x-lark-request-timestamp": "1700000000000",
      "x-lark-request-nonce": "nonce",
      "x-lark-signature": signature,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "challenge-42" });
});

test("rejects an encrypted callback with a bad signature", async () => {
  const encryptKey = "enc-key";
  const plain = JSON.stringify({ challenge: "c", type: "url_verification" });
  const rawBody = JSON.stringify({ encrypt: larkAesEncrypt(encryptKey, plain) });

  const response = await handleLarkWebhook(rawBody, { LARK_ENCRYPT_KEY: encryptKey }, {
    headers: {
      "x-lark-request-timestamp": "1700000000000",
      "x-lark-request-nonce": "nonce",
      "x-lark-signature": "bad-signature",
    },
  });

  assert.equal(response.status, 401);
});

test("parses text messages, strips mention tags and ignores non-text messages", () => {
  const parsed = parseLarkMessageEvent({
    sender: { sender_type: "user" },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: '<at user_id="ou_1">Wayfair 助理</at> DMOM1021 库存风险' }),
      mentions: [
        { id: { open_id: "ou_1", user_id: "ou_1" } },
        { id: { open_id: "ou_2", user_id: "ou_2" } },
      ],
    },
  });

  assert.equal(parsed.messageId, "om_1");
  assert.equal(parsed.chatId, "oc_1");
  assert.equal(parsed.chatType, "group");
  assert.equal(parsed.cleanText, "DMOM1021 库存风险");

  assert.equal(
    parseLarkMessageEvent({
      sender: { sender_type: "user" },
      message: {
        message_id: "om_2",
        chat_id: "oc_1",
        chat_type: "p2p",
        message_type: "image",
        content: JSON.stringify({ image_key: "img_v2" }),
      },
    }),
    null,
  );
});

test("detects whether the bot is mentioned in a group message", () => {
  const withBot = parseLarkMessageEvent({
    sender: { sender_type: "user" },
    message: {
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: '<at user_id="cli_a1">Wayfair 助理</at> 帮助' }),
      mentions: [{ id: { open_id: "ou_bot" } }, { id: { user_id: "cli_a1" } }],
    },
  });
  assert.equal(isMentionedByBot(withBot, "ou_bot"), true);
  assert.equal(isMentionedByBot(withBot, "ou_other"), true);

  const noBot = parseLarkMessageEvent({
    sender: { sender_type: "user" },
    message: {
      message_id: "om_2",
      chat_id: "oc_1",
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: "普通群消息" }),
      mentions: [],
    },
  });
  assert.equal(isMentionedByBot(noBot, "ou_bot"), false);
});

test("replies to a p2p message via the send-message API", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/open-apis/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "t-token", expire: 7200 }));
    }
    if (url.includes("/open-apis/im/v1/messages")) {
      return new Response(JSON.stringify({ code: 0, data: { message_id: "om_new" } }));
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const rawBody = JSON.stringify({
    header: {
      event_id: "event-p2p",
      event_type: "im.message.receive_v1",
      token: "vtok",
    },
    event: {
      sender: { sender_type: "user" },
      message: {
        message_id: "om_in",
        chat_id: "oc_p2p",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "帮助" }),
        mentions: [],
      },
    },
  });

  const pending = [];
  const response = await handleLarkWebhook(rawBody, {
    LARK_APP_ID: "cli_test",
    LARK_APP_SECRET: "secret",
    LARK_VERIFICATION_TOKEN: "vtok",
    DB: { prepare: async () => ({ all: async () => ({ results: [] }) }) },
  }, {
    fetchImpl,
    waitUntil: (promise) => { pending.push(promise); },
  });
  await Promise.all(pending);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  const send = calls.find((call) => call.url.includes("/open-apis/im/v1/messages"));
  assert.ok(send);
  assert.equal(send.init.method, "POST");
  assert.equal(send.init.headers.authorization, "Bearer t-token");
  const payload = JSON.parse(send.init.body);
  assert.equal(payload.receive_id, "oc_p2p");
  assert.equal(payload.msg_type, "text");
  assert.match(payload.content, /当前功能/);
});

test("deduplicates repeated event pushes by event id", async () => {
  const payload = {
    header: { event_id: "event-dup", event_type: "im.message.receive_v1", token: "vtok" },
    event: {
      sender: { sender_type: "user" },
      message: {
        message_id: "om_in",
        chat_id: "oc_p2p",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "帮助" }),
        mentions: [],
      },
    },
  };
  const env = { LARK_APP_ID: "cli_test", LARK_APP_SECRET: "secret", LARK_VERIFICATION_TOKEN: "vtok" };
  const rawBody = JSON.stringify(payload);
  const fetchImpl = async (url) => {
    if (url.includes("/open-apis/auth/v3/tenant_access_token/internal")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "t", expire: 7200 }));
    }
    return new Response(JSON.stringify({ code: 0 }));
  };

  const pending = [];
  const collect = (promise) => { pending.push(promise); };
  const first = await handleLarkWebhook(rawBody, env, { fetchImpl, waitUntil: collect });
  assert.equal(first.status, 200);
  await Promise.all(pending);
  const second = await handleLarkWebhook(rawBody, env, { fetchImpl, waitUntil: collect });
  assert.equal(second.status, 200);
  await Promise.all(pending);
  // Second push must not trigger another model/send flow; the response is still 200.
});
