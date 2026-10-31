// Fonctions pures (testables sans Trimble)
(function (g) {
  const SEP_GUESS = [";", ",", "\t"];
  function csvEscape(v, sep) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /["\n\r]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, "");
    const first = text.split(/\r?\n/)[0] || "";
    const sep = SEP_GUESS.map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(x => x.trim() !== ""));
    const header = nonEmpty.shift() || [];
    return nonEmpty.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || "").trim()])));
  }
  function findKey(obj, names) {
    const keys = Object.keys(obj || {});
    for (const n of names) { const k = keys.find(k => k.toLowerCase() === n); if (k) return k; }
    return null;
  }
  // Retourne [{guid, color?, value?}]
  function normalizeImport(rows) {
    if (!rows.length) return [];
    const kG = findKey(rows[0], ["guid", "ifcguid", "globalid", "ifc_guid", "objectid", "id"]);
    if (!kG) throw new Error("Colonne GUID introuvable (attendu : GUID, GlobalId, IfcGUID…)");
    const kC = findKey(rows[0], ["color", "colour", "couleur"]);
    const kV = findKey(rows[0], ["value", "valeur", "decision", "décision", "statut", "status", "groupe"]);
    return rows.filter(r => r[kG]).map(r => ({ guid: String(r[kG]).trim(), color: kC ? r[kC] : undefined, value: kV ? r[kV] : undefined }));
  }
  const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#9a6324", "#800000"];
  // Groupe par couleur effective -> {color: {label, guids[]}}
  function buildGroups(items) {
    const groups = {}; const valColor = {}; let pi = 0;
    for (const it of items) {
      let color = it.color && /^#?[0-9a-f]{6}$/i.test(it.color) ? (it.color[0] === "#" ? it.color : "#" + it.color) : null;
      let label = it.value || color || "Importé";
      if (!color) {
        const key = it.value || "__default";
        if (!valColor[key]) valColor[key] = PALETTE[pi++ % PALETTE.length];
        color = valColor[key];
      }
      color = color.toUpperCase();
      (groups[color] = groups[color] || { label, guids: [] }).guids.push(it.guid);
    }
    return groups;
  }
  function flattenObject(o) {
    const row = { GUID: o.guid, ModelId: o.modelId, RuntimeId: o.id, Nom: (o.product && o.product.name) || "", Classe: o.class || "", Materiau: "" };
    for (const ps of o.properties || []) for (const p of ps.properties || []) {
      const k = (ps.name || "") + "." + p.name; row[k] = p.value;
      if (!row.Materiau && /mat[ée]ri/i.test(p.name)) row.Materiau = p.value;
    }
    return row;
  }
  function toCSV(objs, sep = ";") {
    const rows = objs.map(flattenObject); const cols = [];
    rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
    return "\uFEFF" + [cols.join(sep)].concat(rows.map(r => cols.map(c => csvEscape(r[c], sep)).join(sep))).join("\r\n");
  }
  const DEFAULTS = { "bois": "#A0522D", "béton": "#9E9E9E", "beton": "#9E9E9E", "acier": "#4682B4" };
  // Liste des attributs (clés de flattenObject hors GUID/ids)
  function attributeKeys(objs) {
    const set = new Set(["Nom", "Materiau", "Classe"]);
    objs.forEach(o => Object.keys(flattenObject(o)).forEach(k => set.add(k)));
    ["GUID", "ModelId", "RuntimeId"].forEach(k => set.delete(k));
    return [...set];
  }
  // {valeur: {color, items:[{modelId,id}]}}
  function groupByAttr(objs, key) {
    const groups = {}; let pi = 0; const used = new Set();
    for (const o of objs) {
      const v = flattenObject(o)[key]; const val = (v === undefined || v === "") ? "(vide)" : String(v);
      (groups[val] = groups[val] || { items: [] }).items.push({ modelId: o.modelId, id: o.id });
    }
    for (const val of Object.keys(groups)) { const d = DEFAULTS[val.toLowerCase()]; if (d) { groups[val].color = d; used.add(d); } }
    for (const val of Object.keys(groups)) if (!groups[val].color) {
      let c; do { c = PALETTE[pi++ % PALETTE.length]; } while (used.has(c) && pi < PALETTE.length * 2); used.add(c); groups[val].color = c;
    }
    return groups;
  }
  function toSelector(items) {
    const by = {}; items.forEach(i => (by[i.modelId] = by[i.modelId] || []).push(i.id));
    return { modelObjectIds: Object.entries(by).map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) };
  }
  function chunk(a, n) { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; }

  // ---- Suprema / N° production (identique à Pièce par pièce) ----
  const PP_STOP = new Set("plans plan atelier vue vues complete cadre cadres zone structure structures poteau poteaux poutre poutres solive solives consoles console taille dessus avec pour dans bois sup1 sup2 suprema niveau etage".split(" "));
  const PROD_NO_KEYS = ["no. production list", "no production list", "production", "productionnumber", "production_number", "n°prod", "numéro_production", "numero_production", "mark", "tag", "piece_mark", "assembly_mark", "bauteilnummer", "pos_nr", "nummer", "number"];
  const fold = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const normKey = s => fold(s).replace(/[^a-z0-9°]/g, "");
  function ppCsvKey(raw) {
    let s = String(raw == null ? "" : raw).trim().replace(/[.,]0+$/, "");
    const m = s.match(/(\d+)(?:\s*([A-Za-z]))?\s*$/);
    if (!m) return null;
    return String(Number(m[1])) + (m[2] ? " " + m[2].toUpperCase() : "");
  }
  function isSupremaRows(rows) {
    if (!rows.length) return false;
    const r = rows[0];
    if (findKey(r, ["guid", "ifcguid", "globalid", "ifc_guid"])) return false;
    return !!Object.keys(r).find(k => fold(k) === "piece");
  }
  function siteTokens(names) {
    const set = new Set();
    for (const n of names) for (const w of fold(n).replace(/\.[a-z0-9]{2,5}$/, "").split(/[^a-z0-9]+/)) {
      if (!w) continue;
      if (/^\d+$/.test(w)) { if (w.length >= 5) set.add(w); }
      else if (w.length >= 4 && !PP_STOP.has(w)) set.add(w);
    }
    return [...set];
  }
  // -> {done:{key:{count,date}}, kept, skipped, noKey}
  function ppCsvParse(rows, tokens) {
    const r0 = rows[0] || {}, ks = Object.keys(r0);
    const kP = ks.find(k => fold(k) === "piece");
    if (!kP) throw new Error("Colonne Pièce introuvable");
    const kS = ks.find(k => fold(k) === "structure"), kD = ks.find(k => fold(k) === "data" || fold(k) === "date");
    const done = {}; let kept = 0, skipped = 0, noKey = 0;
    for (const r of rows) {
      if (kS && tokens && tokens.length) { const st = fold(r[kS]); if (!tokens.some(t => st.includes(t))) { skipped++; continue; } }
      const key = ppCsvKey(r[kP]); if (!key) { noKey++; continue; }
      kept++; const d = done[key] = done[key] || { count: 0, date: "" }; d.count++;
      if (kD && r[kD] && (!d.date || r[kD] > d.date)) d.date = r[kD];
    }
    return { done, kept, skipped, noKey };
  }
  // N° production d'un objet (props aplaties) ; ordre de priorité = ifc_parser.py
  function prodNoOf(o) {
    const props = [];
    for (const ps of o.properties || []) for (const p of ps.properties || []) if (p.value !== undefined && p.value !== null && String(p.value).trim() !== "") props.push([normKey(p.name), p.name, ps.name, p.value]);
    for (const k of PROD_NO_KEYS) { const nk = normKey(k); const hit = props.find(p => p[0] === nk); if (hit) return { value: hit[3], prop: hit[2] + "." + hit[1] }; }
    for (const k of PROD_NO_KEYS) { const nk = normKey(k); const hit = props.find(p => p[0].includes(nk) || (p[0] && nk.includes(p[0]))); if (hit) return { value: hit[3], prop: hit[2] + "." + hit[1] }; }
    return null;
  }
  // -> {key: [{modelId,id}]}, props:{name:count}
  function buildProdMap(objs) {
    const map = {}, props = {};
    for (const o of objs) { const r = prodNoOf(o); if (!r) continue; const k = ppCsvKey(r.value); if (!k) continue;
      (map[k] = map[k] || []).push({ modelId: o.modelId, id: o.id }); props[r.prop] = (props[r.prop] || 0) + 1; }
    return { map, props };
  }
  g.TCLib = { ppCsvKey, isSupremaRows, siteTokens, ppCsvParse, prodNoOf, buildProdMap, parseCSV, normalizeImport, buildGroups, flattenObject, toCSV, chunk, csvEscape, attributeKeys, groupByAttr, toSelector };
  if (typeof module !== "undefined") module.exports = g.TCLib;
})(typeof window !== "undefined" ? window : globalThis);
