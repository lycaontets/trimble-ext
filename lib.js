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
  g.TCLib = { parseCSV, normalizeImport, buildGroups, flattenObject, toCSV, chunk, csvEscape, attributeKeys, groupByAttr, toSelector };
  if (typeof module !== "undefined") module.exports = g.TCLib;
})(typeof window !== "undefined" ? window : globalThis);
