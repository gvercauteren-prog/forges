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
const HOST = "forge-jean-petit.web.app";
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
// Never let the secret show up in the (public) GitHub logs.
const mask = k => { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${k}`); };
let key = settings.feedKey;
if (key) mask(key);
if (!key || !/^[A-Za-z0-9]{20,64}$/.test(key) || process.env.ROTATE === "true") {
  key = crypto.randomBytes(18).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 24).padEnd(24, "x");
  mask(key);
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
// A small page that opens in Safari: the iPhone hands "webcal" links to the Calendar app only from there.
const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Forge Jean-Petit · Agenda</title>
<style>
:root{color-scheme:light dark;--bg:#ECEAE7;--card:#fff;--ink:#1F1D1A;--muted:#66615A;--line:#D9D5CF;--ember:#B4461A}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--card:#1D1B19;--ink:#F2EFEA;--muted:#A8A39B;--line:#34302B;--ember:#F07A3F}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,system-ui,sans-serif;padding:24px 16px}
main{max-width:460px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
h1{font:400 1.5rem Georgia,serif;margin:0 0 6px}p{margin:0 0 14px;color:var(--muted)}
a.big,button{display:flex;justify-content:center;align-items:center;width:100%;box-sizing:border-box;min-height:48px;border-radius:12px;font:600 1rem -apple-system,system-ui,sans-serif;text-decoration:none;cursor:pointer}
a.big{background:var(--ember);color:#fff;border:0;margin:6px 0 10px}
button{background:none;color:var(--ink);border:1px solid var(--line)}
ol{margin:18px 0 0;padding-left:20px;color:var(--ink)}li{margin:4px 0}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:22px 0 0}
code{display:block;margin-top:10px;padding:8px 10px;border-radius:8px;background:var(--bg);font-size:.8rem;word-break:break-all;color:var(--muted)}
</style></head><body><main>
<h1 data-t="title"></h1><p data-t="sub"></p>
<a class="big" id="sub" href="webcal://${HOST}/c/${key}/forge.ics" data-t="btn"></a>
<button type="button" id="copy" data-t="copy"></button>
<h2 data-t="manualH"></h2>
<ol><li data-t="m1"></li><li data-t="m2"></li><li data-t="m3"></li></ol>
<code id="url">https://${HOST}/c/${key}/forge.ics</code>
</main><script>
const T={fr:{title:"Les séjours dans votre agenda",sub:"Touchez le bouton, puis « S'abonner » et « Ajouter ». Les réservations se mettent ensuite à jour toutes seules.",btn:"Ajouter au Calendrier",copy:"Copier l'adresse",copied:"Adresse copiée",manualH:"Si rien ne se passe",m1:"Copiez l'adresse avec le bouton ci-dessus.",m2:"Ouvrez Réglages › Calendrier › Comptes › Ajouter un compte › Autre › Ajouter un calendrier avec abonnement.",m3:"Collez l'adresse, touchez Suivant puis Enregistrer."},
nl:{title:"De verblijven in je agenda",sub:"Tik op de knop, daarna op « Abonneer » en « Voeg toe ». Boekingen blijven daarna vanzelf up-to-date.",btn:"Toevoegen aan Agenda",copy:"Adres kopiëren",copied:"Adres gekopieerd",manualH:"Als er niets gebeurt",m1:"Kopieer het adres met de knop hierboven.",m2:"Open Instellingen › Agenda › Accounts › Voeg account toe › Andere › Voeg agenda-abonnement toe.",m3:"Plak het adres, tik op Volgende en daarna op Bewaar."},
en:{title:"Stays in your calendar",sub:"Tap the button, then Subscribe and Add. Bookings then stay up to date by themselves.",btn:"Add to Calendar",copy:"Copy the address",copied:"Address copied",manualH:"If nothing happens",m1:"Copy the address with the button above.",m2:"Open Settings › Calendar › Accounts › Add Account › Other › Add Subscribed Calendar.",m3:"Paste the address, tap Next, then Save."}};
const l=(navigator.language||"fr").slice(0,2), d=T[l]||T.fr; document.documentElement.lang=T[l]?l:"fr";
document.querySelectorAll("[data-t]").forEach(e=>e.textContent=d[e.dataset.t]);
const u=document.getElementById("url").textContent, c=document.getElementById("copy");
c.onclick=()=>navigator.clipboard.writeText(u).then(()=>{c.textContent=d.copied;setTimeout(()=>c.textContent=d.copy,1600);});
</script></body></html>`;
fs.writeFileSync(path.join(dir, "index.html"), page);
fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${APP}"><title>Forge Jean-Petit</title><a href="${APP}">Forge Jean-Petit</a>`);
fs.writeFileSync(path.join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
fs.writeFileSync(path.join(OUT, "404.html"), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Introuvable</title><p>Cette adresse n'existe pas ou plus.</p>`);
console.log(`Feed: ${stays.length} stays`);
// Hand the key to the next workflow step, which marks it live once it is published.
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`);
