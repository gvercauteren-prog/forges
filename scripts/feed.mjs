// Builds the private calendar feed for Forge Jean-Petit:
//   feed-out/c/<key>/forge.ics    live calendar subscription (iPhone Calendar, Google Calendar…)
// <key> is a long random secret stored in config/settings.feedKey (readable only by members).
// Only family names and dates are published — no e-mail addresses, no notes.
//
// Usage: TOKEN=<oauth access token> node scripts/feed.mjs [outDir]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PROJECT = process.env.PROJECT || "forge-jean-petit";
const BASE = (process.env.FIRESTORE_BASE || "https://firestore.googleapis.com") + `/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOKEN = process.env.TOKEN;
const OUT = process.argv[2] || "feed-out";
const APP = "https://gvercauteren-prog.github.io/forges/";
if (!TOKEN) { console.error("TOKEN is missing"); process.exit(1); }
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

function val(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return fields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  return null;
}
const fields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));
async function call(url, opts = {}) {
  const r = await fetch(url, { headers, ...opts });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${url}\n${await r.text()}`);
  return r.json();
}
async function list(col) {
  const out = []; let page = "";
  do {
    const j = await call(`${BASE}/${col}?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`);
    for (const d of j?.documents || []) out.push({ id: decodeURIComponent(d.name.split("/").pop()), ...fields(d.fields || {}) });
    page = j?.nextPageToken || "";
  } while (page);
  return out;
}

const [bookings, settingsDoc] = await Promise.all([list("bookings"), call(`${BASE}/config/settings`)]);
const settings = settingsDoc ? fields(settingsDoc.fields || {}) : {};

// The secret part of the address: created once, an admin can renew it in the app.
let key = settings.feedKey;
if (!key || !/^[A-Za-z0-9]{20,64}$/.test(key)) {
  key = crypto.randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 24).padEnd(24, "x");
  await call(`${BASE}/config/settings?updateMask.fieldPaths=feedKey`, {
    method: "PATCH", body: JSON.stringify({ fields: { feedKey: { stringValue: key } } }),
  });
  console.log("Created a new feed key");
}

// Family names, same as in the app.
const fams = (settings.families?.length ? settings.families : Array.from({ length: 7 }, (_, i) => ({ id: "f" + (i + 1), name: "Famille " + (i + 1) })));
const famInfo = Object.fromEntries(fams.map(f => [f.id, { name: f.name || f.id }]));
const famName = id => famInfo[id]?.name || "Famille";
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const stays = bookings.filter(b => isDate(b.start) && isDate(b.end)).sort((a, b) => a.start.localeCompare(b.start));

// ---- calendar file
const compact = s => s.replace(/-/g, "");
const nextDay = s => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const nights = b => Math.round((Date.parse(b.end) - Date.parse(b.start)) / 864e5);
const esc = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
function fold(line) {
  const enc = new TextEncoder(), out = []; let cur = "";
  for (const ch of line) { if (enc.encode(cur + ch).length > 74) { out.push(cur); cur = " " + ch; } else cur += ch; }
  out.push(cur); return out.join("\r\n");
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Forge Jean-Petit//Feed//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:Forge Jean-Petit", "X-WR-TIMEZONE:Europe/Brussels", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
for (const b of stays) {
  const n = nights(b);
  ics.push("BEGIN:VEVENT", `UID:${String(b.id).replace(/[^\w-]/g, "")}@forge-jean-petit`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(b.start)}`, `DTEND;VALUE=DATE:${compact(nextDay(b.end))}`,
    `SUMMARY:${esc("Forge · " + famName(b.family))}`,
    `DESCRIPTION:${esc(`${famName(b.family)} — ${n} nuit${n > 1 ? "s" : ""}\n${APP}`)}`,
    "LOCATION:Forge Jean-Petit\\, Chimay", `URL:${APP}`, "TRANSP:TRANSPARENT", "END:VEVENT");
}
ics.push("END:VCALENDAR");

// ---- write the site
const dir = path.join(OUT, "c", key);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "forge.ics"), ics.map(fold).join("\r\n") + "\r\n");
fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${APP}"><title>Forge Jean-Petit</title><a href="${APP}">Forge Jean-Petit</a>`);
fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
fs.writeFileSync(path.join(OUT, "404.html"), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Introuvable</title><p>Cette adresse n'existe pas ou plus.</p>`);
console.log(`Feed: ${stays.length} stays`);
// Hand the key to the next workflow step, which marks it live once it is published.
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`);
