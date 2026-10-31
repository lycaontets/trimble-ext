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
  const SUBGROUP_KEYS = ["sub-group", "subgroup", "sous-groupe", "sousgroupe", "sub_group", "group", "groupe"];
  function subGroupOf(o) {
    const props = [];
    for (const ps of o.properties || []) for (const p of ps.properties || [])
      if (p.value !== undefined && p.value !== null && String(p.value).trim() !== "")
        props.push([normKey(p.name), p.name, ps.name, String(p.value).trim()]);
    for (const k of SUBGROUP_KEYS) {
      const nk = normKey(k);
      const hit = props.find(p => p[0] === nk);
      if (hit) return { value: hit[3], prop: hit[2] + "." + hit[1] };
    }
    // Prefer exact "Sub-group" style names containing subgroup
    const hit2 = props.find(p => p[0] === "subgroup" || p[0] === "sousgroupe" || (p[0].includes("subgroup") && !p[0].includes("type")));
    if (hit2) return { value: hit2[3], prop: hit2[2] + "." + hit2[1] };
    return null;
  }
  // -> { "Cadre CVT 19": [{modelId,id}, ...] }, props:{name:count}
  function buildSubGroupMap(objs) {
    const map = {}, props = {};
    for (const o of objs) {
      const r = subGroupOf(o); if (!r) continue;
      const k = String(r.value || "").trim(); if (!k) continue;
      (map[k] = map[k] || []).push({ modelId: o.modelId, id: o.id });
      props[r.prop] = (props[r.prop] || 0) + 1;
    }
    return { map, props };
  }
  // ---- Plans atelier HTML (Avancement des feuilles) ----
  // Colours match ifc-shop-drawings viewer.js SP_FILL / pg-* bars
  const SHEET_STATUS = {
    todo:    { color: "#4D8DFF", label: "Pas commencé" },
    started: { color: "#FFE066", label: "En cours" },
    done:    { color: "#B9EFC4", label: "Validé" },
  };
  function extractJsonScript(html, pred) {
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html))) {
      const attrs = m[1] || "";
      if (pred(attrs)) {
        const body = String(m[2] || "").trim();
        if (!body) continue;
        try { return JSON.parse(body); } catch (e) { throw new Error("JSON invalide dans script: " + e.message); }
      }
    }
    return null;
  }
  function sheetStatusOf(ann, pageId) {
    const v = ann && ann.validations && ann.validations[pageId];
    if (v && v.name) return "done";
    if (ann && ann.started && ann.started[pageId]) return "started";
    return "todo";
  }
  function aggSheetStatus(list) {
    if (!list || !list.length) return "todo";
    if (list.every(s => s === "done")) return "done";
    if (list.some(s => s !== "todo")) return "started";
    return "todo";
  }
  function decodeHtmlEntities(s) {
    return String(s || "")
      .replace(/&#x27;/gi, "'").replace(/&#39;/gi, "'").replace(/&apos;/gi, "'")
      .replace(/&quot;/gi, '"').replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }
  /** Parse plans_atelier.html → sheet progress + GUID map.
   * Assembled / Timberframe → key = Sub-group (e.g. Cadre CVT 16).
   * Unique → key = data-progress-key (production N°); label = data-progress-label.
   * GUIDs from piece-index (sg / k) and, when present, mesh3d-data.group / productionNo.
   */
  function parseAtelierHtml(html) {
    if (!html || typeof html !== "string") throw new Error("HTML vide");
    const ann = extractJsonScript(html, a => /\bid\s*=\s*["']annotations["']/i.test(a)) || {};
    const pieceIndex = extractJsonScript(html, a => /class\s*=\s*["'][^"']*\bpiece-index\b[^"']*["']/i.test(a)) || [];
    if (pieceIndex && !Array.isArray(pieceIndex)) throw new Error("piece-index invalide");
    const pieces = Array.isArray(pieceIndex) ? pieceIndex : [];

    const guidsBySg = {};
    const guidsByProd = {};
    function addGuid(map, key, g) {
      const k = String(key || "").trim();
      const guid = String(g || "").trim();
      if (!k || !guid) return;
      const set = map[k] || (map[k] = []);
      if (!set.includes(guid)) set.push(guid);
    }
    for (const p of pieces) {
      const sgs = Array.isArray(p.sg) ? p.sg : (p.sg ? [p.sg] : []);
      // Timber mains only — p.d (quincaillerie) is shared across Cadres and muddies colours
      const guids = [];
      if (p.g) guids.push(String(p.g).trim());
      if (Array.isArray(p.gs)) for (const g of p.gs) if (g) guids.push(String(g).trim());
      for (const sg of sgs) for (const g of guids) addGuid(guidsBySg, sg, g);
      const prod = String(p.k || "").trim();
      if (prod) for (const g of guids) addGuid(guidsByProd, prod, g);
    }

    // mesh3d-data (Vue complète / sheets): group = Sub-group (assembled) or N° (unique)
    const meshRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let mm;
    while ((mm = meshRe.exec(html))) {
      if (!/class\s*=\s*["'][^"']*\bmesh3d-data\b/i.test(mm[1] || "")) continue;
      let data;
      try { data = JSON.parse(String(mm[2] || "").trim()); } catch (e) { continue; }
      const meshes = (data && data.meshes) || [];
      for (const m of meshes) {
        if (!m || !m.guid) continue;
        const g = String(m.guid).trim();
        const group = String(m.group || "").trim();
        const pn = String(m.productionNo || "").trim();
        if (group) {
          // Assembled: group is Cadre… ; Unique: group often equals N°
          if (/cadre|ossature|assembl/i.test(group) || /[a-zA-Z]{3,}/.test(group)) addGuid(guidsBySg, group, g);
          else addGuid(guidsByProd, group, g);
        }
        if (pn && pn !== "0" && pn !== "0.0") addGuid(guidsByProd, pn, g);
      }
    }

    const sheets = [];
    const pageRe = /<section\b([^>]*\bclass\s*=\s*["'][^"']*\bpage\b[^"']*["'][^>]*)>([\s\S]*?)(?=<section\b[^>]*\bclass\s*=\s*["'][^"']*\bpage\b|$)/gi;
    let pm;
    while ((pm = pageRe.exec(html))) {
      const attrs = pm[1] || "";
      const body = pm[2] || "";
      if (!/sheet-validation/i.test(body)) continue;
      const idm = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
      const pageId = idm ? idm[1] : "";
      if (!pageId) continue;
      const svm = body.match(/<div\b[^>]*\bclass\s*=\s*["'][^"']*\bsheet-validation\b[^"']*["'][^>]*>/i);
      const svTag = svm ? svm[0] : "";
      const modM = svTag.match(/data-validation-module\s*=\s*["']([^"']+)["']/i);
      const module = modM ? modM[1].toLowerCase() : "";
      const pkM = svTag.match(/data-progress-key\s*=\s*["']([^"']*)["']/i);
      const plM = svTag.match(/data-progress-label\s*=\s*["']([^"']*)["']/i);
      let progressKey = pkM ? decodeHtmlEntities(pkM[1]).trim() : "";
      let progressLabel = plM ? decodeHtmlEntities(plM[1]).trim() : "";
      let sg = "";
      const sgm = body.match(/data-key\s*=\s*["']Sub-group["'][^>]*data-value\s*=\s*["']([^"']*)["']/i)
        || body.match(/data-value\s*=\s*["']([^"']*)["'][^>]*data-key\s*=\s*["']Sub-group["']/i);
      if (sgm) sg = decodeHtmlEntities(sgm[1]).trim();
      let title = "";
      const tm = body.match(/data-sheet-title\s*=\s*["']([^"']*)["']/i);
      if (tm) title = decodeHtmlEntities(tm[1]).trim();
      const isUnique = module === "unique" || !!progressKey;
      let key = "";
      let kind = "subgroup";
      let display = "";
      if (isUnique) {
        kind = "prod";
        key = progressKey;
        display = progressLabel || progressKey;
        if (!key && title) {
          const mProd = title.match(/N[°º]\s*prod\.?\s*([^\s|]+(?:\s+[A-Za-z])?)/i)
            || title.match(/N[°º]\s*production\s*:?\s*([^\s|]+(?:\s+[A-Za-z])?)/i);
          if (mProd) key = mProd[1].trim();
        }
        if (!display) display = key;
      } else {
        kind = "subgroup";
        key = sg;
        if (!key && title) {
          const parts = title.split("|").map(x => x.trim()).filter(Boolean);
          if (parts.length) key = parts[parts.length - 1];
        }
        display = key;
      }
      if (!key) key = title || pageId;
      if (!display) display = key;
      sheets.push({ pageId, sg: key, display, kind, title, module: module || (isUnique ? "unique" : ""), status: sheetStatusOf(ann, pageId) });
    }

    const bySg = {};
    for (const sh of sheets) {
      const key = sh.sg;
      if (!key) continue;
      const fromSg = guidsBySg[key] || [];
      const fromProd = guidsByProd[key] || [];
      const seed = sh.kind === "prod"
        ? (fromProd.length ? fromProd : fromSg)
        : (fromSg.length ? fromSg : fromProd);
      const row = bySg[key] || (bySg[key] = {
        sg: key,
        display: sh.display || key,
        kind: sh.kind || "subgroup",
        statuses: [],
        guids: seed.slice(),
        pages: []
      });
      if (sh.display && (!row.display || row.display === key)) row.display = sh.display;
      if (sh.kind) row.kind = sh.kind;
      row.statuses.push(sh.status);
      row.pages.push(sh.pageId);
      for (const g of seed) if (!row.guids.includes(g)) row.guids.push(g);
    }
    // Orphan subgroups from piece-index (no sheet) — keep as todo
    for (const [sg, guids] of Object.entries(guidsBySg)) {
      if (!bySg[sg]) bySg[sg] = { sg, display: sg, kind: "subgroup", statuses: ["todo"], guids: guids.slice(), pages: [] };
    }
    for (const row of Object.values(bySg)) {
      row.status = aggSheetStatus(row.statuses);
      row.color = SHEET_STATUS[row.status].color;
      row.label = SHEET_STATUS[row.status].label;
      if (!row.display) row.display = row.sg;
      if (!row.kind) row.kind = "subgroup";
    }

    const items = [];
    for (const row of Object.values(bySg)) {
      for (const guid of row.guids) {
        items.push({ guid, color: row.color, value: (row.display || row.sg) + " — " + row.label, key: row.sg, kind: row.kind });
      }
    }
    const kind = Object.values(bySg).some(r => r.kind === "prod") && !Object.values(bySg).some(r => r.kind === "subgroup")
      ? "prod"
      : (Object.values(bySg).some(r => r.kind === "prod") ? "mixed" : "subgroup");
    return { annotations: ann, sheets, bySg, items, pieceIndexCount: pieces.length, labelKind: kind };
  }
  function isAtelierHtml(text, name) {
    if (name && /\.html?$/i.test(name)) return true;
    if (!text) return false;
    return /class=["'][^"']*\bpiece-index\b/i.test(text) || /id=["']annotations["']/i.test(text);
  }

  g.TCLib = { ppCsvKey, isSupremaRows, siteTokens, ppCsvParse, prodNoOf, buildProdMap, subGroupOf, buildSubGroupMap, parseCSV, normalizeImport, buildGroups, flattenObject, toCSV, chunk, csvEscape, attributeKeys, groupByAttr, toSelector, SHEET_STATUS, parseAtelierHtml, isAtelierHtml, sheetStatusOf, aggSheetStatus };
  if (typeof module !== "undefined") module.exports = g.TCLib;
})(typeof window !== "undefined" ? window : globalThis);
