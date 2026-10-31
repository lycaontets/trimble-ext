const L=require("../lib.js"),a=require("assert");
a.strictEqual(L.ppCsvKey("V03_ 3035"),"3035");a.strictEqual(L.ppCsvKey("218 A"),"218 A");a.strictEqual(L.ppCsvKey("149.0"),"149");
const t=L.siteTokens(["7126103 Gymnase Echallens Zone 1 R+0 Cadre CVT.ifc"]);console.log("tokens",t);
a.deepStrictEqual(t,["7126103","gymnase","echallens"]);
const rows=L.parseCSV("Data;Structure;Pièce;W;T;L;Temps\n2026-10-01;7126103 Echallens Cadres;V03_ 3035;1;1;1;1\n2026-10-02;7126103 Echallens Cadres;V03_ 3035;1;1;1;1\n2026-10-02;Lausanne Autre;12;1;1;1;1\n2026-10-03;ÉCHALLENS sup1;218 A;1;1;1;1\n");
a.ok(L.isSupremaRows(rows));a.ok(!L.isSupremaRows([{GUID:"x","Pièce":"1"}]));
const r=L.ppCsvParse(rows,t);console.log(r);a.strictEqual(r.kept,3);a.strictEqual(r.skipped,1);a.strictEqual(r.done["3035"].count,2);
const objs=[{modelId:"m",id:1,properties:[{name:"Cadwork3dProperties",properties:[{name:"No. production list",value:"3035"}]}]},{modelId:"m",id:2,properties:[{name:"P",properties:[{name:"Tag",value:"218A"}]}]}];
const m=L.buildProdMap(objs);console.log(m);a.ok(m.map["3035"]&&m.map["218 A"]);console.log("SUPREMA OK");
