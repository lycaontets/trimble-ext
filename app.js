/* global TrimbleConnectWorkspace, TCLib */
(function () {
  const BATCH = 500;
  const $ = id => document.getElementById(id);
  let api = null, lastFile = null, lastCsvText = null, lastCsvName = "ECHALLENS.csv";
  let lastAtelier = null, lastSgMarkupIds = [], lastSgIcons = [], lastColorMode = null;
  const CONNECT_CSV = { projectId: "ehtiK26Yuww", parentId: "9hDaTpAXRng", fileName: "ECHALLENS.csv", base: "https://app21.connect.trimble.com/tc/api/2.0" };
  let autoTimer = null;
  function log(msg, cls) {
    const d = document.createElement("div"); d.className = cls || "";
    d.textContent = new Date().toLocaleTimeString("fr-CH") + " " + msg; $("log").appendChild(d); $("log").scrollTop = 1e9;
  }
  const err = (ctx, e) => log(ctx + " : " + (e && (e.message || JSON.stringify(e)) || e), "err");
  function download(name, content, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  // modelObjectIds [{modelId, objectRuntimeIds}] -> objets enrichis avec GUID
  async function fetchDetails(mois) {
    const out = [];
    for (const m of mois) {
      const ids = m.objectRuntimeIds || [];
      for (const part of TCLib.chunk(ids, BATCH)) {
        const [props, guids] = await Promise.all([
          api.viewer.getObjectProperties(m.modelId, part),
          api.viewer.convertToObjectIds(m.modelId, part)]);
        props.forEach((p, i) => out.push(Object.assign({ modelId: m.modelId, guid: guids[part.indexOf(p.id)] || guids[i] }, p)));
        log(`… ${out.length} objets lus`);
      }
    }
    return out;
  }
  async function exportObjs(mois, prefix) {
    const n = mois.reduce((s, m) => s + (m.objectRuntimeIds || []).length, 0);
    if (!n) { log("Aucun objet à exporter", "err"); return; }
    log(`Export de ${n} objets…`);
    const objs = await fetchDetails(mois);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`${prefix}_${stamp}.csv`, TCLib.toCSV(objs), "text/csv;charset=utf-8");
    download(`${prefix}_${stamp}.json`, JSON.stringify(objs, null, 2), "application/json");
    log(`Export terminé (${objs.length} objets)`, "ok");
  }
  async function exportSelection() {
    try { await exportObjs(await api.viewer.getSelection(), "selection"); } catch (e) { err("Export sélection", e); }
  }
  async function exportAll() {
    try {
      const mos = await api.viewer.getObjects();
      await exportObjs(mos.map(m => ({ modelId: m.modelId, objectRuntimeIds: m.objects.map(o => o.id) })), "modele");
    } catch (e) { err("Export modèle", e); }
  }
  async function readImport(file) {
    const text = await file.text();
    if (TCLib.isAtelierHtml(text, file.name)) {
      return { atelier: TCLib.parseAtelierHtml(text) };
    }
    let rows;
    if (/\.json$/i.test(file.name) || /^\s*[[{]/.test(text)) {
      const j = JSON.parse(text); rows = Array.isArray(j) ? j : (j.items || j.objects || []);
      rows = rows.map(r => Object.assign({}, r, r.guid && !r.GUID ? { GUID: r.guid } : {}));
    } else rows = TCLib.parseCSV(text);
    if (TCLib.isSupremaRows(rows)) return { suprema: rows };
    return TCLib.normalizeImport(rows);
  }
  const VALIDE = "#00AA00";
  function setText(id, text) {
    const el = $(id); if (el) el.textContent = text;
  }
  async function scanAll() {
    const mos = await api.viewer.getObjects(); const all = [];
    const total = mos.reduce((s, m) => s + m.objects.length, 0); let done = 0;
    for (const m of mos) for (const part of TCLib.chunk(m.objects.map(o => o.id), BATCH)) {
      const props = await api.viewer.getObjectProperties(m.modelId, part);
      props.forEach(p => all.push(Object.assign({ modelId: m.modelId }, p)));
      done += part.length;
      setText("scanProg", `Analyse : ${done}/${total}`);
      if (done === part.length || done === total || done % (BATCH * 4) === 0)
        log(`Analyse modèle : ${done}/${total}`);
    }
    return all;
  }

  function statusViewName() {
    const el = $("viewName");
    return (el && el.value.trim()) || "Suprema Validé";
  }
  async function syncStatusView() {
    if ($("syncView") && !$("syncView").checked) return;
    if (!api || !api.view) { log("API vues indisponible", "err"); return; }
    const name = statusViewName();
    try {
      const bySg = (lastAtelier && lastAtelier.bySg) || loadAtelierCache();
      if (bySg && $("sgLabels") && $("sgLabels").checked && !lastSgMarkupIds.length)
        await placeSubgroupLabels(bySg);
      const views = await api.view.getViews();
      let v = (views || []).find(x => (x.name || x.title) === name);
      if (!v) {
        v = await api.view.createView({ name });
        log(`Vue créée : ${name}`, "ok");
      } else {
        await api.view.updateView({ id: v.id });
        log(`Vue mise à jour : ${name}`, "ok");
      }
    } catch (e) { err("Vue partagée", e); }
  }
  async function openStatusView() {
    try {
      if (!api || !api.view) throw new Error("API vues indisponible");
      const name = statusViewName();
      const views = await api.view.getViews();
      const v = (views || []).find(x => (x.name || x.title) === name);
      if (!v) throw new Error("Vue introuvable : " + name + " — cochez « Mettre à jour la vue » puis Actualiser d'abord");
      await api.view.selectView(v.id);
      log(`Vue ouverte : ${name}`, "ok");
    } catch (e) { err("Ouvrir vue", e); }
  }


  function hexToRgba(hex) {
    const h = String(hex || "").replace("#", "");
    if (h.length !== 6) return { r: 0, g: 0, b: 0, a: 255 };
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 255 };
  }
  function bboxStatsMm(box) {
    if (!box) return null;
    const b = box.boundingBox || box;
    const min = b.min || b.Min, max = b.max || b.Max;
    if (!min || !max) return null;
    const vals = [Number(min.x), Number(min.y), Number(min.z), Number(max.x), Number(max.y), Number(max.z)];
    if (vals.some(v => Number.isNaN(v))) return null;
    const scale = vals.every(v => Math.abs(v) < 1e5) ? 1000 : 1;
    const mn = { x: Number(min.x) * scale, y: Number(min.y) * scale, z: Number(min.z) * scale };
    const mx = { x: Number(max.x) * scale, y: Number(max.y) * scale, z: Number(max.z) * scale };
    return {
      min: mn, max: mx,
      cx: (mn.x + mx.x) / 2, cy: (mn.y + mx.y) / 2, cz: (mn.z + mx.z) / 2,
      topZ: Math.max(mn.z, mx.z)
    };
  }
  function saveAtelierCache(bySg) {
    try {
      const slim = {};
      for (const [k, r] of Object.entries(bySg || {})) {
        slim[k] = { sg: r.sg || k, display: r.display || r.sg || k, kind: r.kind || "subgroup", status: r.status, color: r.color, guids: (r.guids || []).slice(0, 120) };
      }
      sessionStorage.setItem("tcAtelierBySg", JSON.stringify(slim));
    } catch (e) { /* ignore quota */ }
  }
  function loadAtelierCache() {
    try {
      const s = sessionStorage.getItem("tcAtelierBySg");
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
  function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function badgeDataUrl(text, bg) {
    const label = String(text || "");
    const w = Math.max(160, 24 + label.length * 10);
    const h = 32;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="5" ry="5" fill="${bg || "#4D8DFF"}" stroke="#222" stroke-width="1"/>` +
      `<text x="${w / 2}" y="${h / 2 + 5}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="15" font-weight="700" fill="#111">${escapeXml(label)}</text>` +
      `</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  async function clearSubgroupLabels() {
    try {
      if (api && api.markup && api.markup.removeMarkups) {
        if (lastSgMarkupIds.length) await api.markup.removeMarkups(lastSgMarkupIds);
        if (api.markup.getTextMarkups) {
          const all = await api.markup.getTextMarkups();
          const ours = (all || []).filter(m => m && m.id != null && (m._tcAtelier || /^Cadre\b/i.test(String(m.text || "")) || /^\d+[A-Za-z]?\b/.test(String(m.text || "")) || /×/.test(String(m.text || ""))));
          const ids = ours.map(m => m.id).filter(id => !lastSgMarkupIds.includes(id));
          if (ids.length) await api.markup.removeMarkups(ids);
        }
      }
    } catch (e) { /* ignore */ }
    lastSgMarkupIds = [];
    try {
      if (api && api.viewer && api.viewer.removeIcon) {
        if (lastSgIcons.length) await api.viewer.removeIcon(lastSgIcons);
        else await api.viewer.removeIcon();
      }
    } catch (e) { /* ignore */ }
    lastSgIcons = [];
  }
  function markupAddFn() {
    if (!api || !api.markup) return null;
    return api.markup.addTextMarkup || api.markup.addTextMarkups || null;
  }
  async function placeSubgroupLabels(bySg) {
    if (!$("sgLabels") || !$("sgLabels").checked) return;
    bySg = bySg || (lastAtelier && lastAtelier.bySg) || loadAtelierCache();
    if (!bySg || !Object.keys(bySg).length) {
      log("Pas de libellés HTML en mémoire — cliquez Appliquer sur le HTML atelier", "err");
      return;
    }
    const addFn = markupAddFn();
    const canIcon = !!(api && api.viewer && api.viewer.addIcon);
    if (!addFn && !canIcon) {
      log("API libellés indisponible (markup/icon)", "err");
      return;
    }
    await clearSubgroupLabels();
    const models = await api.viewer.getModels("loaded");
    const placedIds = [];
    const icons = [];
    let fail = 0, iconN = 0, markupN = 0;
    for (const row of Object.values(bySg)) {
      if (!row.guids || !row.guids.length) { fail++; continue; }
      let done = false;
      try {
        for (const m of models) {
          if (done) break;
          for (const part of TCLib.chunk(row.guids, BATCH)) {
            const rids = await api.viewer.convertToObjectRuntimeIds(m.id, part);
            const ok = [], guidsOk = [];
            rids.forEach((r, i) => {
              if (r !== undefined && r !== null && r >= 0) { ok.push(r); guidsOk.push(part[i]); }
            });
            if (!ok.length) continue;
            const boxes = await api.viewer.getObjectBoundingBoxes(m.id, ok.slice(0, 40));
            let sx = 0, sy = 0, sz = 0, topZ = -Infinity, n = 0, rid0 = ok[0], guid0 = guidsOk[0];
            (boxes || []).forEach((bx, i) => {
              const s = bboxStatsMm(bx);
              if (!s) return;
              sx += s.cx; sy += s.cy; sz += s.cz; if (s.topZ > topZ) topZ = s.topZ; n++;
              if (i === 0 && bx && (bx.runtimeId != null || bx.id != null)) rid0 = bx.runtimeId != null ? bx.runtimeId : bx.id;
            });
            if (!n) continue;
            const cx = sx / n, cy = sy / n, cz = sz / n;
            if (!Number.isFinite(topZ)) topZ = cz;
            const bg = row.color || "#4D8DFF";
            // Pill icon (meters) — same look as HTML status chips
            if (canIcon) {
              icons.push({
                id: icons.length + 1,
                position: { x: cx / 1000, y: cy / 1000, z: (topZ + 1800) / 1000 },
                iconPath: badgeDataUrl(row.display || row.sg, bg),
                size: 1.2
              });
              iconN++;
            }
            // Text markup too (saved into the shared view)
            if (addFn) {
              const tip = {
                type: "point", modelId: m.id, objectId: rid0, referenceObjectId: guid0,
                positionX: cx, positionY: cy, positionZ: topZ
              };
              const textPos = {
                type: "point", modelId: m.id, objectId: rid0, referenceObjectId: guid0,
                positionX: cx, positionY: cy, positionZ: topZ + 2500
              };
              const added = await addFn.call(api.markup, [{ text: (row.display || row.sg), start: tip, end: textPos, color: hexToRgba(bg) }]);
              const id = added && added[0] && added[0].id;
              if (id != null) { placedIds.push(id); markupN++; }
            }
            done = true;
            break;
          }
        }
      } catch (e) {
        err("Libellé " + (row.display || row.sg), e);
        fail++;
        continue;
      }
      if (!done) { log("Libellé non placé (GUID introuvable) : " + (row.display || row.sg)); fail++; }
    }
    if (icons.length && canIcon) {
      try {
        await api.viewer.addIcon(icons);
        lastSgIcons = icons.slice();
      } catch (e) {
        err("Icônes libellés", e);
        // fallback: try one-by-one
        lastSgIcons = [];
        for (const ic of icons) {
          try { await api.viewer.addIcon(ic); lastSgIcons.push(ic); } catch (e2) { err("Icône " + ic.id, e2); }
        }
        iconN = lastSgIcons.length;
      }
    }
    lastSgMarkupIds = placedIds;
    log(`Libellés HTML : ${iconN} pastilles` + (markupN ? `, ${markupN} markups` : "") + (fail ? ` (${fail} manqués)` : ""), (iconN || markupN) ? "ok" : "err");
  }
  async function ensureSubgroupLabelsBeforeView() {
    const bySg = (lastAtelier && lastAtelier.bySg) || loadAtelierCache();
    if (!bySg) return;
    if (!$("sgLabels") || !$("sgLabels").checked) return;
    await placeSubgroupLabels(bySg);
  }
  async function applyAtelier(parsed) {
    lastAtelier = parsed;
    lastColorMode = "atelier";
    // Keep HTML colours — Auto CSV would overwrite them every 30 s
    if ($("autoRefresh") && $("autoRefresh").checked) {
      $("autoRefresh").checked = false;
      setAutoRefresh(false);
      log("Auto CSV désactivé pour garder les couleurs / libellés HTML", "ok");
    }
    if ($("viewName") && (!$("viewName").value.trim() || $("viewName").value.trim() === "Suprema Validé"))
      $("viewName").value = "Avancement feuilles";
    const rows = Object.values(parsed.bySg || {});
    const counts = { todo: 0, started: 0, done: 0 };
    rows.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    const kindTxt = parsed.labelKind === "prod" ? "N° production" : (parsed.labelKind === "mixed" ? "sous-groupe + N°" : "sous-groupe");
    log(`HTML atelier : ${parsed.sheets.length} feuilles (${kindTxt}), ${parsed.pieceIndexCount} pièces index — Validé ${counts.done}, En cours ${counts.started}, Pas commencé ${counts.todo}`);

    // Unique sheets with no piece-index: resolve GUIDs from model production numbers
    const needProd = rows.some(r => r.kind === "prod" && !(r.guids && r.guids.length));
    if (needProd) {
      log("Résolution N° production depuis le modèle…");
      const scanned = await scanAll();
      const { map } = TCLib.buildProdMap(scanned);
      let filled = 0;
      for (const r of rows) {
        if (r.kind !== "prod" || (r.guids && r.guids.length)) continue;
        const key = TCLib.ppCsvKey(r.sg);
        const hits = map[key] || map[String(r.sg).trim()] || [];
        // Prefer GUIDs: scan again via convert — store runtime→guid through properties if present
        for (const h of hits) {
          // h = {modelId, id}; we need GUID — fetch one batch later; stash runtime for now
          if (!r._runtimes) r._runtimes = [];
          r._runtimes.push(h);
        }
        if (hits.length) filled++;
      }
      // Convert runtime ids to GUIDs
      for (const r of rows) {
        if (!r._runtimes || !r._runtimes.length) continue;
        const byModel = {};
        for (const h of r._runtimes) (byModel[h.modelId] = byModel[h.modelId] || []).push(h.id);
        const guids = r.guids || (r.guids = []);
        for (const [mid, ids] of Object.entries(byModel)) {
          for (const part of TCLib.chunk(ids, BATCH)) {
            const gids = await api.viewer.convertToObjectIds(mid, part);
            (gids || []).forEach(g => { if (g && !guids.includes(g)) guids.push(g); });
          }
        }
        delete r._runtimes;
      }
      // Rebuild items after fill
      parsed.items = [];
      for (const row of rows) {
        for (const guid of row.guids || []) {
          parsed.items.push({ guid, color: row.color, value: (row.display || row.sg) + " — " + row.label, key: row.sg, kind: row.kind });
        }
      }
      log(`N° résolus depuis le modèle : ${filled} feuilles`, filled ? "ok" : "err");
    }

    const items = parsed.items || [];
    if (!items.length) { log("Aucun GUID (piece-index / N° production) trouvé", "err"); return; }

    const models = await api.viewer.getModels("loaded");
    const mode = $("mode").value, allSel = [], legend = $("legend"); legend.innerHTML = "";
    let found = 0;
    // Colour + legend per sheet key (subgroup or production N°)
    const sorted = rows.slice().sort((a, b) => String(a.display || a.sg).localeCompare(String(b.display || b.sg), "fr", { numeric: true }));
    for (const row of sorted) {
      const guids = row.guids || [];
      if (!guids.length) continue;
      const mois = [];
      for (const m of models) {
        const rids = [];
        for (const part of TCLib.chunk(guids, BATCH)) {
          const r = await api.viewer.convertToObjectRuntimeIds(m.id, part);
          r.forEach(x => { if (x !== undefined && x !== null && x >= 0) rids.push(x); });
        }
        if (rids.length) mois.push({ modelId: m.id, objectRuntimeIds: rids });
      }
      const cnt = mois.reduce((s, m) => s + m.objectRuntimeIds.length, 0); found += cnt;
      allSel.push(...mois);
      if (cnt && mode === "color") await api.viewer.setObjectState({ modelObjectIds: mois }, { color: row.color });
      const d = document.createElement("div");
      d.innerHTML = `<span class="sw" style="background:${row.color}"></span><span></span>`;
      d.lastChild.textContent = `${row.display || row.sg} — ${row.label} (${cnt}/${guids.length})`;
      legend.appendChild(d);
    }
    if (!found) { log("Aucun GUID du HTML trouvé dans les modèles chargés", "err"); return; }
    if (mode === "select") await api.viewer.setSelection({ modelObjectIds: allSel }, "set");
    if (mode === "isolate") {
      await api.viewer.setObjectState(undefined, { visible: false });
      await api.viewer.setObjectState({ modelObjectIds: allSel }, { visible: true });
    }
    log(`${found} objets colorés depuis le HTML (${mode})`, "ok");
    if (mode === "color") {
      saveAtelierCache(parsed.bySg);
      await placeSubgroupLabels(parsed.bySg);
      await syncStatusView();
    }
  }

    async function applySuprema(rows) {
    lastColorMode = "suprema";
    const models = await api.viewer.getModels("loaded"); const names = models.map(m => m.name || "");
    try { const p = await api.project.getProject(); if (p && p.name) names.push(p.name); } catch (e) { /* ignore */ }
    const tokens = TCLib.siteTokens(names);
    log(`CSV Suprema : ${rows.length} lignes — jetons chantier : ${tokens.join(", ") || "(aucun, pas de filtre)"}`);
    const res = TCLib.ppCsvParse(rows, tokens);
    log(`Structure : ${res.kept} lignes gardées, ${res.skipped} ignorées (autre chantier)${res.noKey ? `, ${res.noKey} sans N°` : ""} — ${Object.keys(res.done).length} N° distincts`);
    if (!scanned) scanned = await scanAll();
    const { map, props } = TCLib.buildProdMap(scanned);
    log(`N° production lus via : ${Object.entries(props).map(([k, n]) => `${k} (${n})`).join(", ") || "aucune propriété trouvée"} — ${Object.keys(map).length} N° dans le modèle`);
    const items = [], unmatched = []; let matched = 0;
    for (const [k, d] of Object.entries(res.done)) {
      const objs = map[k]; if (!objs) { unmatched.push(k); continue; }
      matched++; items.push(...objs.slice(0, Math.min(d.count, objs.length)));
    }
    const legend = $("legend"); legend.innerHTML = "";
    if (!items.length) { log("Aucun N° du CSV trouvé dans le modèle", "err"); }
    else {
      const sel = TCLib.toSelector(items).modelObjectIds, mode = $("mode").value;
      if (mode === "color") await api.viewer.setObjectState({ modelObjectIds: sel }, { color: VALIDE });
      if (mode === "select") await api.viewer.setSelection({ modelObjectIds: sel }, "set");
      if (mode === "isolate") { await api.viewer.setObjectState(undefined, { visible: false }); await api.viewer.setObjectState({ modelObjectIds: sel }, { visible: true }); }
      const d = document.createElement("div");
      d.innerHTML = `<span class="sw" style="background:${VALIDE}"></span><span></span>`;
      d.lastChild.textContent = `Validé (${items.length} pièces, ${matched} N°)`; legend.appendChild(d);
      log(`${matched} N° trouvés, ${items.length} pièces traitées (${mode}) en Validé`, "ok");
      if (mode === "color") {
        await ensureSubgroupLabelsBeforeView();
        await syncStatusView();
      }
    }
    if (unmatched.length) log(`${unmatched.length} N° absents du modèle : ${unmatched.sort((a, b) => parseInt(a) - parseInt(b)).join(", ")}`);
  }

  async function getAccessToken() {
    if (!api || !api.extension || !api.extension.requestPermission) throw new Error("Workspace API: requestPermission indisponible");
    const t = await api.extension.requestPermission("accesstoken");
    if (!t) throw new Error("Jeton Connect refusé");
    return typeof t === "string" ? t : (t.token || t.accessToken || t.access_token);
  }
  async function connectFetch(path) {
    const tok = await getAccessToken();
    const r = await fetch(CONNECT_CSV.base + path, { headers: { Authorization: "Bearer " + tok, Accept: "application/json" } });
    const text = await r.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!r.ok) throw new Error((body && (body.message || body.detail || body.title)) || ("HTTP " + r.status));
    return body;
  }
  async function downloadConnectCsv() {
    let items = await connectFetch(`/folders/${CONNECT_CSV.parentId}/items`);
    if (items && !Array.isArray(items)) items = items.data || items.items || items.files || [];
    const f = (items || []).find(it => (it.type === "FILE" || String(it.type).toUpperCase() === "FILE") && it.name === CONNECT_CSV.fileName);
    if (!f) throw new Error("Fichier " + CONNECT_CSV.fileName + " introuvable dans Connect (lancez le watcher)");
    const tok = await getAccessToken();
    let url = f.downloadURL || f.downloadUrl || f.url;
    if (!url) {
      const dl = await connectFetch(`/files/fs/${f.id}/downloadurl`);
      url = (typeof dl === "string" ? dl : (dl && (dl.url || dl.downloadURL || dl.downloadUrl))) || null;
    }
    if (!url) throw new Error("Pas d'URL de téléchargement pour " + CONNECT_CSV.fileName);
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) throw new Error("Téléchargement CSV HTTP " + r.status);
    const text = await r.text();
    lastCsvText = text; lastCsvName = f.name;
    return { text, name: f.name, id: f.id, versionId: f.versionId };
  }
  async function applyCsvText(text, name) {
    lastCsvText = text; lastCsvName = name || lastCsvName;
    let rows;
    if (/^\s*[[{]/.test(text)) {
      const j = JSON.parse(text); rows = Array.isArray(j) ? j : (j.items || j.objects || []);
      rows = rows.map(r => Object.assign({}, r, r.guid && !r.GUID ? { GUID: r.guid } : {}));
      const items = TCLib.normalizeImport(rows);
      // reuse GUID path via temp
      lastFile = new File([text], name || "import.json", { type: "application/json" });
      await applyImport();
      return;
    }
    rows = TCLib.parseCSV(text);
    if (TCLib.isSupremaRows(rows)) { await applySuprema(rows); return; }
    lastFile = new File([text], name || "import.csv", { type: "text/csv" });
    await applyImport();
  }
  async function refreshFromConnect() {
    try {
      if (lastColorMode === "atelier") {
        log("Mode HTML actif — Actualiser CSV ignoré (recliquez Appliquer sur le HTML, ou Réinitialiser puis Actualiser)");
        const bySg = (lastAtelier && lastAtelier.bySg) || loadAtelierCache();
        if (bySg) {
          await placeSubgroupLabels(bySg);
          await syncStatusView();
        }
        return;
      }
      log("Actualisation depuis Connect…");
      const d = await downloadConnectCsv();
      await applyCsvText(d.text, d.name);
      log("Couleurs actualisées (pas de rechargement de page)", "ok");
    } catch (e) { err("Actualiser Connect", e); }
  }
  function setAutoRefresh(on) {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (!on) return;
    autoTimer = setInterval(() => refreshFromConnect(), 30000);
    log("Auto-refresh couleurs toutes les 30 s", "ok");
  }

  async function applyImport() {
    try {
      const f = $("file").files[0] || lastFile; if (!f) { log("Choisir un fichier", "err"); return; }
      const items = await readImport(f);
      if (items.atelier) { await applyAtelier(items.atelier); return; }
      if (items.suprema) { await applySuprema(items.suprema); return; }
      log(`${items.length} lignes avec GUID lues`);
      const groups = TCLib.buildGroups(items);
      const models = await api.viewer.getModels("loaded");
      const mode = $("mode").value, allSel = [], legend = $("legend"); legend.innerHTML = "";
      let found = 0;
      for (const [color, g] of Object.entries(groups)) {
        const mois = [];
        for (const m of models) {
          const rids = [];
          for (const part of TCLib.chunk(g.guids, BATCH)) {
            const r = await api.viewer.convertToObjectRuntimeIds(m.id, part);
            r.forEach(x => { if (x !== undefined && x !== null && x >= 0) rids.push(x); });
          }
          if (rids.length) mois.push({ modelId: m.id, objectRuntimeIds: rids });
        }
        const cnt = mois.reduce((s, m) => s + m.objectRuntimeIds.length, 0); found += cnt;
        allSel.push(...mois);
        if (cnt && mode === "color") await api.viewer.setObjectState({ modelObjectIds: mois }, { color });
        const d = document.createElement("div");
        d.innerHTML = `<span class="sw" style="background:${color}"></span><span></span>`;
        d.lastChild.textContent = `${g.label} (${cnt}/${g.guids.length})`; legend.appendChild(d);
      }
      if (!found) { log("Aucun GUID trouvé dans les modèles chargés", "err"); return; }
      if (mode === "select") await api.viewer.setSelection({ modelObjectIds: allSel }, "set");
      if (mode === "isolate") {
        await api.viewer.setObjectState(undefined, { visible: false });
        await api.viewer.setObjectState({ modelObjectIds: allSel }, { visible: true });
      }
      log(`${found} objets trouvés et traités (${mode})`, "ok");
      if (mode === "color") await syncStatusView();
    } catch (e) { err("Import", e); }
  }
  async function reset() {
    try {
      await clearSubgroupLabels();
      lastColorMode = null;
      await api.viewer.setObjectState(undefined, { color: "reset", visible: "reset" });
      await api.viewer.setSelection({ modelObjectIds: [] }, "set");
      $("legend").innerHTML = ""; $("attrLegend").innerHTML = ""; log("Affichage réinitialisé", "ok");
    } catch (e) { err("Réinitialisation", e); }
  }
  // ---- Colorer par ----
  let scanned = null, attrGroups = null;
  async function scan() {
    try {
      const mos = await api.viewer.getObjects(); const all = [];
      const total = mos.reduce((s, m) => s + m.objects.length, 0); let done = 0;
      for (const m of mos) for (const part of TCLib.chunk(m.objects.map(o => o.id), BATCH)) {
        const props = await api.viewer.getObjectProperties(m.modelId, part);
        props.forEach(p => all.push(Object.assign({ modelId: m.modelId }, p)));
        done += part.length; setText("scanProg", `Analyse : ${done}/${total}`);
      }
      scanned = all; const sel = $("attr");
      if (sel) {
        const cur = sel.value; sel.innerHTML = "";
        const lbl = { Nom: "Nom", Materiau: "Matériau", Classe: "Classe IFC" };
        TCLib.attributeKeys(all).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = lbl[k] || k; sel.appendChild(o); });
        if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
        log(`${all.length} objets analysés, ${sel.options.length} attributs`, "ok");
      } else {
        log(`${all.length} objets analysés`, "ok");
      }
    } catch (e) { err("Analyse", e); }
  }
  async function colorBy() {
    try {
      if (!scanned) await scan(); if (!scanned) return;
      attrGroups = TCLib.groupByAttr(scanned, $("attr").value);
      const leg = $("attrLegend"); leg.innerHTML = "";
      for (const [val, g] of Object.entries(attrGroups)) {
        await api.viewer.setObjectState(TCLib.toSelector(g.items), { color: g.color, visible: true });
        const d = document.createElement("div");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
        cb.onchange = () => api.viewer.setObjectState(TCLib.toSelector(g.items), { visible: cb.checked }).catch(e => err("Visibilité", e));
        const cp = document.createElement("input"); cp.type = "color"; cp.value = g.color.toLowerCase();
        cp.oninput = () => { g.color = cp.value; api.viewer.setObjectState(TCLib.toSelector(g.items), { color: cp.value }).catch(e => err("Couleur", e)); };
        const t = document.createElement("span"); t.textContent = `${val} (${g.items.length})`;
        d.append(cb, cp, t); leg.appendChild(d);
      }
      log(`Coloration par « ${$("attr").selectedOptions[0].textContent} » : ${Object.keys(attrGroups).length} valeurs`, "ok");
    } catch (e) { err("Colorer par", e); }
  }
  async function showAll() {
    try { await api.viewer.setObjectState(undefined, { visible: true });
      document.querySelectorAll("#attrLegend input[type=checkbox]").forEach(c => (c.checked = true)); log("Tout affiché", "ok");
    } catch (e) { err("Tout afficher", e); }
  }
  async function colorSelection() {
    try {
      const sel = (await api.viewer.getSelection()).filter(m => (m.objectRuntimeIds || []).length);
      if (!sel.length) { log("Aucune sélection", "err"); return; }
      await api.viewer.setObjectState({ modelObjectIds: sel }, { color: $("selColor").value });
      log(`Sélection colorée en ${$("selColor").value}`, "ok");
    } catch (e) { err("Colorer la sélection", e); }
  }
  async function refreshInfo() {
    try {
      const p = await api.project.getProject(); $("project").textContent = `${p.name || "?"} (${p.id})`;
      const ms = await api.viewer.getModels("loaded"); $("models").innerHTML = "";
      ms.forEach(m => { const li = document.createElement("li"); li.textContent = m.name; $("models").appendChild(li); });
      if (!ms.length) $("models").innerHTML = "<li>Aucun modèle chargé</li>";
    } catch (e) { err("Infos projet", e); }
  }
  async function init() {
    try {
      const W = window.TrimbleConnectWorkspace;
      if (!W) throw new Error("Bibliothèque Workspace API non chargée");
      api = window.__MOCK_API__ || await W.connect(window.parent, (event, data) => {
        if (event === "viewer.onModelStateChanged") { scanned = null; refreshInfo(); }
      }, 30000);
      log("Connecté à Trimble Connect", "ok");
      const cached = loadAtelierCache();
      if (cached) { lastAtelier = { bySg: cached }; log("Sous-groupes HTML en cache : " + Object.keys(cached).length, "ok"); }
      await refreshInfo();
    } catch (e) { err("Connexion", e); }
  }
  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on("btnSel", "onclick", exportSelection); on("btnAll", "onclick", exportAll);
  on("file", "onchange", () => { lastFile = $("file").files[0] || lastFile; });
  on("btnApply", "onclick", applyImport); on("btnRefreshConnect", "onclick", refreshFromConnect);
  on("btnOpenView", "onclick", openStatusView);
  on("autoRefresh", "onchange", () => setAutoRefresh($("autoRefresh").checked));
  on("btnReset", "onclick", reset);
  on("btnScan", "onclick", scan); on("btnColorBy", "onclick", colorBy); on("btnShowAll", "onclick", showAll); on("btnColorSel", "onclick", colorSelection);
  window.__TCAPP__ = { scan, colorBy, showAll, colorSelection, applyImport, applyAtelier, refreshFromConnect, syncStatusView, openStatusView, exportAll, exportSelection, reset, setFile: f => (lastFile = f) };
  init();
})();
