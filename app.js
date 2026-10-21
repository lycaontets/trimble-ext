/* global TrimbleConnectWorkspace, TCLib */
(function () {
  const BATCH = 500;
  const $ = id => document.getElementById(id);
  let api = null, lastFile = null;
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
    return TCLib.normalizeImport(rows);
  }
  async function applyImport() {
    try {
      const f = $("file").files[0] || lastFile; if (!f) { log("Choisir un fichier", "err"); return; }
      const items = await readImport(f); log(`${items.length} lignes avec GUID lues`);
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
  $("btnApply").onclick = applyImport; $("btnReset").onclick = reset;
  $("btnScan").onclick = scan; $("btnColorBy").onclick = colorBy; $("btnShowAll").onclick = showAll; $("btnColorSel").onclick = colorSelection;
  window.__TCAPP__ = { scan, colorBy, showAll, colorSelection, applyImport, exportAll, exportSelection, reset, setFile: f => (lastFile = f) };
  init();
})();
