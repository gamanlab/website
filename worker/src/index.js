// Gamanlab contact form → email, via Cloudflare Email Routing (free for verified destinations).
// Receives POST multipart/form-data from https://gamanlab.id and replies with JSON { ok: boolean }.
import { EmailMessage } from "cloudflare:email";

const ALLOWED_ORIGINS = ["https://gamanlab.id", "https://www.gamanlab.id"];
const LIMITS = { name: 100, email: 150, topic: 100, message: 5000 };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Vary": "Origin",
    };
    const reply = (ok, status = 200) =>
      new Response(JSON.stringify({ ok }), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(false, 405);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply(false, 403);

    let form;
    try { form = await request.formData(); } catch { return reply(false, 400); }
    const field = (k) => String(form.get(k) ?? "").trim();

    // Honeypot: bots fill the hidden "website" field. Pretend success so they don't retry.
    if (field("website")) return reply(true);

    // Strip CR/LF from anything that ends up in a header (prevents header injection).
    const oneLine = (s) => s.replace(/[\r\n]+/g, " ");
    const name = oneLine(field("name"));
    const email = oneLine(field("email"));
    const topic = oneLine(field("topic")) || "Kontak";
    const message = field("message");

    if (!name || !email || !message) return reply(false, 400);
    if (name.length > LIMITS.name || email.length > LIMITS.email ||
        topic.length > LIMITS.topic || message.length > LIMITS.message) return reply(false, 400);
    if (!/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(email)) return reply(false, 400);

    const body =
      `Nama     : ${name}\n` +
      `Email    : ${email}\n` +
      `Keperluan: ${topic}\n` +
      `Waktu    : ${new Date().toISOString()}\n` +
      `IP       : ${request.headers.get("CF-Connecting-IP") || "-"}\n` +
      `\n${message}\n`;

    const raw = buildMime({
      from: `Gamanlab Website <${env.CONTACT_FROM}>`,
      to: env.CONTACT_TO,
      replyTo: email,
      subject: `[gamanlab.id] ${topic} — ${name}`,
      domain: env.CONTACT_FROM.split("@")[1],
      body,
    });

    try {
      await env.CONTACT.send(new EmailMessage(env.CONTACT_FROM, env.CONTACT_TO, raw));
      return reply(true);
    } catch (err) {
      console.error("send failed:", err && err.message);
      return reply(false, 502);
    }
  },
};

function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function buildMime({ from, to, replyTo, subject, domain, body }) {
  const encodedBody = b64utf8(body).replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${replyTo}`,
    `Subject: =?UTF-8?B?${b64utf8(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
}
