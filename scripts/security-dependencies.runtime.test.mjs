import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const { simpleParser } = require("mailparser");

test("updated mail packages preserve recipients and attachment bytes without contacting SMTP", async () => {
  const attachment = Buffer.from("security-upgrade-attachment\n", "utf8");
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const result = await transport.sendMail({
    from: { name: "Bookie test", address: "sender@example.invalid" },
    to: "recipient@example.invalid",
    replyTo: "reply@example.invalid",
    subject: "Security dependency compatibility",
    text: "Attachment compatibility check",
    attachments: [{ filename: "invoice.xml", content: attachment, contentType: "application/xml" }],
  });
  assert.deepEqual(result.envelope.to, ["recipient@example.invalid"]);
  const parsed = await simpleParser(result.message);
  assert.equal(parsed.to.value[0].address, "recipient@example.invalid");
  assert.equal(parsed.replyTo.value[0].address, "reply@example.invalid");
  assert.equal(parsed.attachments[0].filename, "invoice.xml");
  assert.deepEqual(parsed.attachments[0].content, attachment);
});

test("updated multer accepts valid uploads and enforces file size limits with async filtering", async t => {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 32 },
    fileFilter(_req, _file, done) {
      setImmediate(() => done(null, true));
    },
  });
  app.post("/upload", upload.single("file"), (req, res) => {
    res.json({ size: req.file.size, text: req.file.buffer.toString("utf8") });
  });
  app.use((error, _req, res, _next) => {
    res.status(413).json({ code: error.code });
  });
  const server = createServer(app).listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/upload`;
  async function send(content) {
    const form = new FormData();
    form.set("file", new Blob([content]), "test.txt");
    return fetch(url, { method: "POST", body: form });
  }
  const oversized = await send("x".repeat(64));
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { code: "LIMIT_FILE_SIZE" });
  const valid = await send("test");
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { size: 4, text: "test" });
});
