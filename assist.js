// Forge Jean-Petit — understands short requests in French, Dutch and English,
// e.g. "je veux réserver du 20 au 22 décembre pour ma famille", "is het vrij volgend weekend?",
// "who is there at Christmas?". Everything runs in the browser: nothing is sent anywhere.
//
// parseRequest(text, { today: "YYYY-MM-DD", families: [{id, name, words:[...]}] })
//   → { start, end, nights, intent: "book"|"free"|"who"|"next"|null, familyId, needsMonth, note }

const MONTHS = {
  1: ["janvier","janv","january","jan","januari"],
  2: ["fevrier","fevr","fev","february","feb","februari"],
  3: ["mars","march","mar","maart","mrt"],
  4: ["avril","avr","april","apr"],
  5: ["mai","may","mei"],
  6: ["juin","june","jun","juni"],
  7: ["juillet","juil","july","jul","juli"],
  8: ["aout","august","aug","augustus"],
  9: ["septembre","sept","september","sep"],
  10: ["octobre","oct","october","oktober","okt"],
  11: ["novembre","nov","november"],
  12: ["decembre","dec","december"],
};
const MONTH_OF = {};
for (const [m, ws] of Object.entries(MONTHS)) for (const w of ws) MONTH_OF[w] = Number(m);
const MONTH_RE = Object.keys(MONTH_OF).sort((a, b) => b.length - a.length).join("|");

const NUMBER_WORDS = { un: 1, une: 1, one: 1, een: 1, deux: 2, two: 2, twee: 2, trois: 3, three: 3, drie: 3, quatre: 4, four: 4, vier: 4,
  cinq: 5, five: 5, vijf: 5, six: 6, zes: 6, sept: 7, seven: 7, zeven: 7, huit: 8, eight: 8, acht: 8, neuf: 9, nine: 9, negen: 9,
  dix: 10, ten: 10, tien: 10, quinze: 15, fifteen: 15, vijftien: 15 };
const WEEK_WORDS = { semaine: 7, week: 7 };

const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[’']/g, "'").replace(/\b1er\b/g, "1").replace(/(\d+)(st|nd|rd|th|e|de|ste)\b/g, "$1").replace(/\s+/g, " ").trim();

const dnum = s => { const [y, m, d] = s.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const dstr = n => new Date(n * 864e5).toISOString().slice(0, 10);
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// pick the year so the date is not in the past (a stay in "janvier" asked in October is next year)
function withYear(m, d, today, y) {
  if (y) { y = y < 100 ? 2000 + y : y; return valid(y, m, d) ? iso(y, m, d) : null; }
  const ty = Number(today.slice(0, 4));
  for (const yy of [ty, ty + 1]) if (valid(yy, m, d) && iso(yy, m, d) >= today) return iso(yy, m, d);
  return valid(ty + 1, m, d) ? iso(ty + 1, m, d) : null;
}

const SEP = "(?:-|–|—|au|a|tot|to|till|until|jusqu'au|jusqu'a|t\\/m|tem|\\/)";

function findRange(t, today) {
  let m;
  // 20 décembre au 2 janvier · 20 dec 2026 - 2 jan 2027
  if ((m = t.match(new RegExp(`\\b(\\d{1,2}) (${MONTH_RE})\\.?(?: (\\d{4}))? ?${SEP} ?(\\d{1,2}) (${MONTH_RE})\\.?(?: (\\d{4}))?\\b`)))) {
    const s = withYear(MONTH_OF[m[2]], +m[1], today, m[3] && +m[3]);
    let e = s && withYear(MONTH_OF[m[5]], +m[4], s, m[6] && +m[6]);
    return s && e ? { start: s, end: e } : null;
  }
  // du 20 au 22 décembre · 20-22 dec · van 20 tot 22 december
  if ((m = t.match(new RegExp(`\\b(\\d{1,2}) ?${SEP} ?(\\d{1,2}) (${MONTH_RE})\\.?(?: (\\d{4}))?\\b`)))) {
    const mo = MONTH_OF[m[3]], y = m[4] && +m[4];
    const e = withYear(mo, +m[2], today, y);
    if (!e) return null;
    let s = iso(+e.slice(0, 4), mo, +m[1]);
    if (+m[1] > +m[2]) { // 28 au 3 janvier → 28 décembre
      const pm = mo === 1 ? 12 : mo - 1, py = mo === 1 ? +e.slice(0, 4) - 1 : +e.slice(0, 4);
      s = valid(py, pm, +m[1]) ? iso(py, pm, +m[1]) : null;
    } else if (!valid(+e.slice(0, 4), mo, +m[1])) s = null;
    return s ? { start: s, end: e } : null;
  }
  // december 20 to 22 · dec 20-22
  if ((m = t.match(new RegExp(`\\b(${MONTH_RE})\\.? (\\d{1,2}) ?${SEP} ?(\\d{1,2})\\b`)))) {
    const s = withYear(MONTH_OF[m[1]], +m[2], today);
    const e = s && (+m[3] >= +m[2] ? iso(+s.slice(0, 4), MONTH_OF[m[1]], +m[3]) : null);
    return s && e && valid(+e.slice(0, 4), MONTH_OF[m[1]], +m[3]) ? { start: s, end: e } : null;
  }
  // 20/12 au 22/12 · 20.12-22.12.2026
  if ((m = t.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))? ?(?:-|–|au|a|tot|to|till|until|jusqu'au|t\/m) ?(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/))) {
    const s = withYear(+m[2], +m[1], today, m[3] && +m[3]);
    const e = s && withYear(+m[5], +m[4], s, m[6] && +m[6]);
    return s && e ? { start: s, end: e } : null;
  }
  return null;
}

function findDay(t, today) {
  let m;
  if ((m = t.match(new RegExp(`\\b(\\d{1,2}) (${MONTH_RE})\\.?(?: (\\d{4}))?\\b`)))) return withYear(MONTH_OF[m[2]], +m[1], today, m[3] && +m[3]);
  if ((m = t.match(new RegExp(`\\b(${MONTH_RE})\\.? (\\d{1,2})\\b`)))) return withYear(MONTH_OF[m[1]], +m[2], today);
  if ((m = t.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/))) return withYear(+m[2], +m[1], today, m[3] && +m[3]);
  const T = dnum(today);
  if (/\b(aujourd'hui|today|vandaag|ce soir|tonight|vanavond)\b/.test(t)) return today;
  if (/\b(apres-demain|day after tomorrow|overmorgen)\b/.test(t)) return dstr(T + 2);
  if (/\b(demain|tomorrow|morgen)\b/.test(t)) return dstr(T + 1);
  return null;
}

function findNights(t) {
  let m;
  if ((m = t.match(/\b(\d{1,2}|[a-z]+) (nuits?|nights?|nachten|nacht)\b/)) && (/^\d+$/.test(m[1]) || NUMBER_WORDS[m[1]])) return +m[1] || NUMBER_WORDS[m[1]];
  if ((m = t.match(/\b(\d{1,2}|[a-z]+) (semaines?|weeks?|weken)\b/)) && (/^\d+$/.test(m[1]) || NUMBER_WORDS[m[1]])) return 7 * (+m[1] || NUMBER_WORDS[m[1]]);
  if ((m = t.match(/\b(une|one|een|a) (semaine|week)\b/))) return 7;
  return null;
}

function findWeekend(t, today) {
  const T = dnum(today), wd = (new Date(T * 864e5).getUTCDay() + 6) % 7; // 0 = Monday
  let fri = T + ((4 - wd + 7) % 7);
  if (wd === 5 || wd === 6) fri = T - (wd - 4);      // already in the weekend: this one
  if (/\b(week-?end prochain|prochain week-?end|next week-?end|volgend weekend|volgende weekend)\b/.test(t)) fri += 7;
  else if (!/\b(ce|this|dit|deze|le) week-?end\b/.test(t)) return null;
  return { start: dstr(Math.max(fri, T)), end: dstr(fri + 2) };
}

function findHoliday(t, today) {
  const y = Number(today.slice(0, 4));
  const pick = (mm, dd, len) => { let s = iso(y, mm, dd); if (s < today) s = iso(y + 1, mm, dd); return { start: s, end: dstr(dnum(s) + len) }; };
  if (/\b(noel|christmas|kerst|kerstmis)\b/.test(t)) return pick(12, 24, 2);
  if (/\b(nouvel an|reveillon|new year|oud en nieuw|nieuwjaar)\b/.test(t)) return pick(12, 31, 1);
  return null;
}

export function parseRequest(text, { today, families = [] } = {}) {
  const t = norm(text);
  const out = { start: null, end: null, nights: null, intent: null, familyId: null, needsMonth: false };
  if (!t) return out;

  if (/\b(qui|who|wie)\b/.test(t)) out.intent = "who";
  else if (/\b(libre|libres|dispo|disponible|disponibles|free|available|vrij|beschikbaar|bezet|occupe|taken)\b/.test(t)) out.intent = "free";
  else if (/(prochain sejour|next stay|volgend verblijf|volgende verblijf|mon sejour|my stay|mijn verblijf|quand (est|suis|sommes)|when (is|am|are) (my|we|i))/.test(t)) out.intent = "next";
  if (/\b(reserv\w*|book\w*|boek\w*|reserveer\w*)\b/.test(t)) out.intent = out.intent === "who" ? "who" : "book";

  let r = findRange(t, today) || findWeekend(t, today) || findHoliday(t, today);
  const nights = findNights(t);
  if (!r) {
    const d = findDay(t, today);
    if (d) r = { start: d, end: nights ? dstr(dnum(d) + nights) : null };
  }
  if (r) {
    out.start = r.start; out.end = r.end;
    if (!out.end && nights) out.end = dstr(dnum(r.start) + nights);
    if (out.end && out.end <= out.start) out.end = null;
    out.nights = out.end ? dnum(out.end) - dnum(out.start) : null;
  } else if (/\b\d{1,2} ?(?:-|au|tot|to) ?\d{1,2}\b/.test(t)) out.needsMonth = true;

  // a family named in the sentence ("pour Chloé et Roger", "voor Lorraine")
  for (const f of families) {
    if ((f.words || []).some(w => w && w.length > 2 && new RegExp(`\\b${norm(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))) { out.familyId = f.id; break; }
  }
  if (!out.intent && out.start) out.intent = "book";
  return out;
}
