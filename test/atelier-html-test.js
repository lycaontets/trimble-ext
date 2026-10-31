const L = require("../lib.js");
const a = require("assert");

const html = `<!DOCTYPE html><html><body>
<script type="application/json" id="annotations">{"labels":[],"started":{"page-3":{"date":"2026-10-31T10:00:00","title":"x"}},"validations":{"page-4":{"name":"Ada","date":"2026-10-31T11:00:00"}}}</script>
<script type="application/json" class="piece-index">[
 {"k":"32","n":1,"name":"Sommier","g":"GUID16","gs":["GUID16"],"sg":["Cadre CVT 16"],"u":0},
 {"k":"33","n":1,"name":"Sommier","g":"GUID17","gs":["GUID17"],"sg":["Cadre CVT 17"],"u":0},
 {"k":"34","n":1,"name":"Sommier","g":"GUID18","gs":["GUID18"],"sg":["Cadre CVT 18"],"u":0}
]</script>
<section class="page" id="page-2" data-index="1">
  <div class="sheet-validation" data-sheet-title="Gymnase | Cadres CVT | Cadre CVT 16">
    <span class="sv-field" data-key="Sub-group" data-value="Cadre CVT 16"></span>
    <span class="sv-status">Non validé</span>
  </div>
</section>
<section class="page" id="page-3" data-index="2">
  <div class="sheet-validation" data-sheet-title="Gymnase | Cadres CVT | Cadre CVT 17">
    <span class="sv-field" data-key="Sub-group" data-value="Cadre CVT 17"></span>
  </div>
</section>
<section class="page" id="page-4" data-index="3">
  <div class="sheet-validation" data-sheet-title="Gymnase | Cadres CVT | Cadre CVT 18">
    <span class="sv-field" data-key="Sub-group" data-value="Cadre CVT 18"></span>
  </div>
</section>
</body></html>`;

a.ok(L.isAtelierHtml(html, "x.html"));
const p = L.parseAtelierHtml(html);
a.strictEqual(p.sheets.length, 3);
a.strictEqual(p.bySg["Cadre CVT 16"].status, "todo");
a.strictEqual(p.bySg["Cadre CVT 17"].status, "started");
a.strictEqual(p.bySg["Cadre CVT 18"].status, "done");
a.strictEqual(p.bySg["Cadre CVT 16"].color, "#4D8DFF");
a.strictEqual(p.bySg["Cadre CVT 17"].color, "#FFE066");
a.strictEqual(p.bySg["Cadre CVT 18"].color, "#B9EFC4");
a.ok(p.bySg["Cadre CVT 16"].guids.includes("GUID16"));
a.ok(p.items.length >= 3);
console.log("ATELIER HTML OK", Object.fromEntries(Object.entries(p.bySg).map(([k,v])=>[k,v.status])));
