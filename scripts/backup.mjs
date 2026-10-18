// Reads every Forge Jean-Petit collection from Firestore and writes one backup file
// in the same format as the app's "Sauvegarder (fichier)" button, so it can be
// restored with "Restaurer ou importer…" in Admin.
//
// Usage: TOKEN=<oauth access token> node scripts/backup.mjs <output folder>
// Optional: FIRESTORE_BASE to point at an emulator, MARK=1 to note the time in config/settings.
import fs from "node:fs";
import path from "node:path";

const PROJECT = process.env.PROJECT || "forge-jean-petit";
const BASE = (process.env.FIRESTORE_BASE || "https://firestore.googleapis.com") + `/v1/projects/${PROJECT}/databases/(default)/documents`;
const TOKEN = process.env.TOKEN;
const OUT = process.argv[2] || "backups";
if (!TOKEN) { console.error("TOKEN is missing"); process.exit(1); }
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// Firestore REST values -> plain JSON
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
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
const fields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, val(v)]));
const idOf = name => decodeURIComponent(name.split("/").pop());

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
    for (const d of j?.documents || []) out.push({ id: idOf(d.name), ...fields(d.fields || {}) });
    page = j?.nextPageToken || "";
  } while (page);
  return out;
}
async function one(p) { const d = await call(`${BASE}/${p}`); return d ? fields(d.fields || {}) : null; }

const [members, bookings, tips, notes, supplies, settings, info] = await Promise.all([
  list("members"), list("bookings"), list("tips"), list("notes"), list("supplies"), one("config/settings"), one("config/info"),
]);
if (!members.length && !bookings.length) { console.error("Firestore returned nothing — not writing an empty backup."); process.exit(1); }

const now = new Date();
const backup = {
  version: 1, kind: "backup", exportedAt: now.toISOString(),
  source: `Sauvegarde automatique Forge Jean-Petit · ${now.toLocaleString("fr-BE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Brussels" })}`,
  families: Object.fromEntries((settings?.families || []).map(f => [f.id, f.name])),
  members: members.map(m => ({ email: m.id, family: m.family || "", name: m.name || "", admin: !!m.admin })),
  bookings: bookings.map(b => ({ id: b.id, family: b.family, start: b.start, end: b.end, name: b.name || "", note: b.note || "",
    guests: b.guests || null, checklist: b.checklist || {}, bookedBy: b.email || "", createdAt: b.createdAt || "" })),
  tips: tips.map(x => ({ id: x.id, title: x.title, category: x.category, address: x.address || "", url: x.url || "", note: x.note || "", name: x.name || "" })),
  checklist: settings?.checklist || [], contacts: settings?.contacts || [], info: info?.sections || [],
  notes, supplies,
};

fs.mkdirSync(OUT, { recursive: true });
const day = now.toISOString().slice(0, 10);
const text = JSON.stringify(backup, null, 2) + "\n";
fs.writeFileSync(path.join(OUT, `forge-jean-petit-${day}.json`), text);
fs.writeFileSync(path.join(OUT, "derniere-sauvegarde.json"), text);
console.log(`Backup ${day}: ${bookings.length} stays, ${members.length} people, ${tips.length} tips, ${notes.length} notes, ${supplies.length} to buy`);

// Note the time so the Admin page shows the last backup (only this one field is changed).
if (process.env.MARK === "1") {
  await call(`${BASE}/config/settings?updateMask.fieldPaths=lastAutoBackupAt`, {
    method: "PATCH", body: JSON.stringify({ fields: { lastAutoBackupAt: { stringValue: now.toISOString() } } }),
  });
  console.log("Marked lastAutoBackupAt in config/settings");
}
