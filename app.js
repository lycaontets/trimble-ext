/* global TrimbleConnectWorkspace, TCLib */
(function () {
  const BATCH = 500;
  const $ = id => document.getElementById(id);
  let api = null, lastFile = null, lastCsvText = null, lastCsvName = "ECHALLENS.csv";
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
    let rows;
    if (/\.json$/i.test(file.name) || /^\s*[[{]/.test(text)) {
      const j = JSON.parse(text); rows = Array.isArray(j) ? j : (j.items || j.objects || []);
      rows = rows.map(r => Object.assign({}, r, r.guid && !r.GUID ? { GUID: r.guid } : {}));
    } else rows = TCLib.parseCSV(text);
    if (TCLib.isSupremaRows(rows)) return { suprema: rows };
    return TCLib.normalizeImport(rows);
  }
  const VALIDE = "#00AA00";
  async function scanAll() {
    const mos = await api.viewer.getObjects(); const all = [];
    const total = mos.reduce((s, m) => s + m.objects.length, 0); let done = 0;
    for (const m of mos) for (const part of TCLib.chunk(m.objects.map(o => o.id), BATCH)) {
      const props = await api.viewer.getObjectProperties(m.modelId, part);
      props.forEach(p => all.push(Object.assign({ modelId: m.modelId }, p)));
      done += part.length; $("scanProg").textContent = `Analyse : ${done}/${total}`;
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
      const views = await api.view.getViews();
      let v = (views || []).find(x => (x.name || x.title) === name);
      if (!v) {
        v = await api.view.createView({ name });
        log(`Vue créée : ${name}`, "ok");
      } else {
        // Capture current colours/camera into the existing view
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

  async function applySuprema(rows) {
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
      if (mode === "color") await syncStatusView();
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
        done += part.length; $("scanProg").textContent = `Analyse : ${done}/${total}`;
      }
      scanned = all; const sel = $("attr"), cur = sel.value; sel.innerHTML = "";
      const lbl = { Nom: "Nom", Materiau: "Matériau", Classe: "Classe IFC" };
      TCLib.attributeKeys(all).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = lbl[k] || k; sel.appendChild(o); });
      if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
      log(`${all.length} objets analysés, ${sel.options.length} attributs`, "ok");
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
      await refreshInfo();
    } catch (e) { err("Connexion", e); }
  }
  $("btnSel").onclick = exportSelection; $("btnAll").onclick = exportAll;
  $("file").onchange = () => { lastFile = $("file").files[0] || lastFile; };
  $("btnApply").onclick = applyImport; $("btnRefreshConnect").onclick = refreshFromConnect;
  $("btnOpenView").onclick = openStatusView;
  $("autoRefresh").onchange = () => setAutoRefresh($("autoRefresh").checked);
  $("btnReset").onclick = reset;
  $("btnScan").onclick = scan; $("btnColorBy").onclick = colorBy; $("btnShowAll").onclick = showAll; $("btnColorSel").onclick = colorSelection;
  window.__TCAPP__ = { scan, colorBy, showAll, colorSelection, applyImport, refreshFromConnect, syncStatusView, openStatusView, exportAll, exportSelection, reset, setFile: f => (lastFile = f) };
  init();
})();
