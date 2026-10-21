const fs=require("fs"),path=require("path");const {JSDOM}=require("jsdom");
const root=path.join(__dirname,"..");
const html=fs.readFileSync(root+"/index.html","utf8").replace(/<script src="https[^>]*><\/script>/,"");
const dom=new JSDOM(html,{runScripts:"outside-only",url:"http://localhost/"});const w=dom.window;
const calls=[],downloads=[];
const objs={m1:[{id:1,class:"IfcBeam",product:{name:"Sommier"},properties:[{name:"Pset_JPF",properties:[{name:"Matériau",value:"Bois"},{name:"Note",value:'a;"b"'}]}]},
 {id:2,class:"IfcColumn",product:{name:"Poteau"},properties:[{name:"Pset_JPF",properties:[{name:"Matériau",value:"Acier"}]}]}]};
const guid={1:"2O2Fr$t4X7Zf8NOew3FLOH",2:"3cUkl32yn9qRSPvBJVyWYp"};
w.__MOCK_API__={project:{getProject:async()=>({id:"r8_El2jpzYg",name:"Projet test"})},
 viewer:{getModels:async()=>[{id:"m1",name:"Charpente.ifc"}],getSelection:async()=>[{modelId:"m1",objectRuntimeIds:[2]}],
 getObjects:async()=>[{modelId:"m1",objects:objs.m1.map(o=>({id:o.id}))}],
 getObjectProperties:async(m,ids)=>objs[m].filter(o=>ids.includes(o.id)),
 convertToObjectIds:async(m,ids)=>ids.map(i=>guid[i]),
 convertToObjectRuntimeIds:async(m,g)=>g.map(x=>{const k=Object.keys(guid).find(k=>guid[k]===x);return k?+k:undefined}),
 setObjectState:async(s,st)=>calls.push(["state",s,st]),setSelection:async(s,m)=>calls.push(["sel",s,m])}};
w.TrimbleConnectWorkspace={};w.URL.createObjectURL=b=>{downloads.push(b);return "blob:x"};
w.HTMLAnchorElement.prototype.click=function(){};
for(const f of ["lib.js","app.js"]) w.eval(fs.readFileSync(root+"/"+f,"utf8"));
(async()=>{await new Promise(r=>setTimeout(r,50));const d=w.document;
 console.log("Projet:",d.getElementById("project").textContent,"| Modèles:",d.getElementById("models").textContent);
 await w.__TCAPP__.exportAll(); const csv=await downloads[0].text(); console.log("CSV:\n"+csv);
 await w.__TCAPP__.exportSelection(); console.log("JSON sélection:",(await downloads[3].text()).slice(0,120).replace(/\s+/g," "));
 const file={name:"_decisions.csv",text:async()=>"GUID;Decision\n2O2Fr$t4X7Zf8NOew3FLOH;OK\n3cUkl32yn9qRSPvBJVyWYp;A revoir\nINCONNU;OK\n"};
 w.__TCAPP__.setFile(file); await w.__TCAPP__.applyImport();
 console.log("Légende:",[...d.querySelectorAll("#legend div")].map(x=>x.textContent));
 d.getElementById("mode").value="isolate"; await w.__TCAPP__.applyImport(); await w.__TCAPP__.reset();
 calls.length=0; await w.__TCAPP__.scan();
 const opts=[...d.querySelectorAll("#attr option")].map(o=>o.textContent); console.log("Attributs:",opts, "|", d.getElementById("scanProg").textContent);
 d.getElementById("attr").value="Materiau"; await w.__TCAPP__.colorBy();
 console.log("Légende attr:",[...d.querySelectorAll("#attrLegend div")].map(x=>x.textContent+" "+x.querySelector("input[type=color]").value));
 const row=d.querySelector("#attrLegend div"); const cp=row.querySelector("input[type=color]"); cp.value="#00ff00"; cp.dispatchEvent(new w.Event("input"));
 const cb=row.querySelector("input[type=checkbox]"); cb.checked=false; cb.dispatchEvent(new w.Event("change"));
 await w.__TCAPP__.showAll(); d.getElementById("selColor").value="#123456"; await w.__TCAPP__.colorSelection(); await new Promise(r=>setTimeout(r,10));
 const want=JSON.stringify(["#A0522D","#4682B4"]); const got=JSON.stringify(calls.slice(0,2).map(c=>c[2].color));
 if(got!==want) {console.log("ECHEC couleurs par défaut",got);process.exitCode=1;}
 console.log("Appels:",JSON.stringify(calls));console.log("Journal:\n"+d.getElementById("log").textContent.replace(/(\d\d:\d\d:\d\d)/g,"\n$1"));
 const err=d.querySelectorAll("#log .err").length; console.log(err?"ERREURS: "+err:"TEST OK");})();
