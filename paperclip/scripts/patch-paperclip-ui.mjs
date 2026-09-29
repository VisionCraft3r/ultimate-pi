import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const replacements = [
  {
    file: "AiConnectionCredentialStep-",
    from: 'j==="pi_local"?"thinking":"effort"',
    to: 'j==="pi_local"||j==="ultimate_pi"?"thinking":"effort"',
  },
  {
    file: "AiConnectionCredentialStep-",
    from: 'j==="pi_local"?[{id:"",label:"Auto"},...["off","minimal","low","medium","high","xhigh"].map(b=>({id:b,label:b}))]',
    to: 'j==="pi_local"||j==="ultimate_pi"?[{id:"",label:"Auto"},...["off","minimal","low","medium","high","xhigh"].map(b=>({id:b,label:b}))]',
  },
  {
    file: "AiConnectionCredentialStep-",
    from: '(Z||j==="process"||Ar?.fields.some(b=>fo(b.key)==="advanced"))',
    to: '((Z&&j!=="ultimate_pi")||j==="process"||Ar?.fields.some(b=>fo(b.key)==="advanced"))',
  },
  {
    file: "AiConnectionCredentialStep-",
    from: 'Z&&(0,i.jsxs)(i.Fragment,{children:["              ",!B&&(0,i.jsx)(L,{label:"Command"',
    to: 'Z&&j!=="ultimate_pi"&&(0,i.jsxs)(i.Fragment,{children:["              ",!B&&(0,i.jsx)(L,{label:"Command"',
  },
  {
    file: "AiConnectionCredentialStep-",
    from: 'dn("adapter"),Z&&String(G.persona??"")!=="orchestrator"&&(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(Uk,',
    to: 'dn("adapter"),Z&&(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(Uk,',
  },
  {
    file: "AiConnectionCredentialStep-",
    from: 'jp&&String(G.persona??"")!=="orchestrator"&&(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(Kk,',
    to: 'jp&&(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(Kk,',
  },
  {
    file: "index-",
    from: '{value:"tools",label:"Tools"},{value:"channels",label:"Channels"}',
    to: "",
  },
  {
    file: "index-",
    from: '(0,t.jsx)(ta,{to:"/apps",label:"Connectors",icon:x2}),',
    to: "",
  },
  {
    file: "index-",
    from: 'y?(0,t.jsx)(za,{to:"/apps",label:"Connectors",icon:x2}):null,',
    to: "",
  },
  {
    file: "index-",
    from: '(0,t.jsx)(rt,{path:"apps",element:(0,t.jsx)(NNt,{})})',
    to: '(0,t.jsx)(rt,{path:"apps",element:(0,t.jsx)(En,{to:"/agents/all",replace:!0})})',
  },
  {
    file: "index-",
    from: 'children:N.map(T=>{const _=Mx(T.type);',
    to: 'children:N.filter(T=>T.type==="ultimate_pi").map(T=>{const _=Mx(T.type);',
  },
  {
    file: "index-",
    from: 'se(Hze),re("claude_local")',
    to: 'se(Hze),re("ultimate_pi")',
  },
  {
    file: "index-",
    from: 'if(J==="paperclip_runner"){re("claude_local")',
    to: 'if(J==="paperclip_runner"){re("ultimate_pi")',
  },
  {
    file: "index-",
    from: 'function Gze(e){return typeof e=="string"&&e!=="paperclip_runner"?e:"claude_local"}',
    to: 'function Gze(e){return typeof e=="string"&&e!=="paperclip_runner"?e:"ultimate_pi"}',
  },
  {
    file: "index-",
    from: '[l,c]=(0,d.useState)(!1),u=(0,d.useRef)(null),m=ye({mutationFn:()=>Jr.create(e,{name:r.trim(),status:"planned",repositoryIds:i.map(p=>p.id)}),onSuccess:()=>{n.invalidateQueries({queryKey:E.projects.all(e)}),s()}});',
    to: '[l,c]=(0,d.useState)(!1),[f,h]=(0,d.useState)(""),[g,x]=(0,d.useState)("create"),[v,w]=(0,d.useState)(""),u=(0,d.useRef)(null),k=async()=>{const rows=await (await fetch("/api/plugins")).json();const row=(Array.isArray(rows)?rows:[]).find(q=>q.pluginKey==="visioncraft3r.ultimate-pi");if(!row?.id)throw new Error("Ultimate PI is not ready.");return row.id},y=async()=>{w("");const id=await k();const started=await fetch(`/api/plugins/${id}/actions/chooseProjectFolder`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({companyId:e,params:{prompt:g==="load"?"Select the existing project folder":"Select the folder to create the project in"}})});const startBody=await started.json();if(!started.ok)throw new Error(startBody.message||"Could not open the folder picker.");for(let nTry=0;nTry<180;nTry++){await new Promise(q=>setTimeout(q,500));const res=await fetch(`/api/plugins/${id}/actions/readProjectFolder`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({companyId:e,params:{}})});const body=await res.json();const pick=body.data;if(!pick||pick.status==="open")continue;if(pick.status==="chosen"&&pick.path){h(pick.path);if(g==="load")a(T=>T.trim()?T:pick.path.split("/").filter(Boolean).pop()||"");return}throw new Error(pick.message||"Folder selection was cancelled.")}throw new Error("The folder picker timed out.")},m=ye({mutationFn:async()=>{const id=await k();const prepared=await fetch(`/api/plugins/${id}/actions/prepareProjectFolder`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({companyId:e,params:{mode:g,folder:f.trim(),name:r.trim()}})});const body=await prepared.json();if(!prepared.ok)throw new Error(body.message||"Could not use that folder.");return Jr.create(e,{name:r.trim()||body.data.name,status:"planned",workspace:{cwd:body.data.cwd,sourceType:"local_path",isPrimary:!0,name:r.trim()||body.data.name}})},onSuccess:()=>{n.invalidateQueries({queryKey:E.projects.all(e)}),s()}});',
  },
  {
    file: "index-",
    from: 'onSubmit:p=>{p.preventDefault(),r.trim()&&!m.isPending&&m.mutate()}',
    to: 'onSubmit:p=>{p.preventDefault(),r.trim()&&f.trim()&&!m.isPending&&m.mutate()}',
  },
  {
    file: "index-",
    from: 'placeholder:"Project name",required:!0,className:"h-10 w-full min-w-0 border-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"})]})]}),(0,t.jsx)("div",{role:"region","aria-label":"Source repositories"',
    to: 'placeholder:"Project name",required:!0,className:"h-10 w-full min-w-0 border-0 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"})]}),(0,t.jsxs)("div",{className:"flex flex-col gap-2",children:[(0,t.jsxs)("div",{className:"flex gap-2",children:[(0,t.jsx)(L,{type:"button",variant:g==="create"?"default":"ghost",disabled:m.isPending,onClick:()=>x("create"),children:"New folder"}),(0,t.jsx)(L,{type:"button",variant:g==="load"?"default":"ghost",disabled:m.isPending,onClick:()=>x("load"),children:"Existing folder"})]}),(0,t.jsxs)("div",{className:"flex items-center gap-2",children:[(0,t.jsx)("input",{"aria-label":"Project folder",value:f,readOnly:!0,placeholder:g==="load"?"Existing project folder":"Folder to create the project in",className:"h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 text-base outline-none placeholder:text-muted-foreground md:text-sm"}),(0,t.jsx)(L,{type:"button",variant:"ghost",disabled:m.isPending,onClick:()=>{y().catch(p=>w(p instanceof Error?p.message:String(p)))},children:"Choose folder"})]}),(0,t.jsx)("p",{className:"text-xs text-muted-foreground",children:g==="load"?"Use a folder that already exists on this computer.":"A new folder named after the project is created inside the selected folder."})]})]}),(0,t.jsx)("div",{role:"region","aria-label":"Source repositories"',
  },
  {
    file: "index-",
    from: 'm.isError&&(0,t.jsx)("p",{role:"alert",className:"px-5 pt-3 text-sm text-destructive",children:m.error.message})',
    to: '(m.isError||v)&&(0,t.jsx)("p",{role:"alert",className:"px-5 pt-3 text-sm text-destructive",children:v||m.error.message})',
  },
  {
    file: "index-",
    from: 'disabled:!r.trim()||m.isPending,children:m.isPending?"Creating…":"Create project"',
    to: 'disabled:!r.trim()||!f.trim()||m.isPending,children:m.isPending?g==="load"?"Loading…":"Creating…":g==="load"?"Load project":"Create project"',
  },
];

export function patchBundleText(source, replacement) {
  if (source.includes(replacement.from)) return { text: source.replaceAll(replacement.from, replacement.to), status: "applied" };
  if (source.includes(replacement.to)) return { text: source, status: "already" };
  return { text: source, status: "missing" };
}

export function findUiFiles(root) {
  const hits = [];
  function walk(dir, depth) {
    if (depth > 7) return;
    let entries = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let info;
      try {
        info = statSync(path);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        if (name === ".git") continue;
        walk(path, depth + 1);
        continue;
      }
      if (!path.includes("/ui-dist/assets/")) continue;
      if (name.startsWith("AiConnectionCredentialStep-") || (name.startsWith("index-") && name.endsWith(".js"))) {
        hits.push(path);
      }
    }
  }
  walk(root, 0);
  return hits;
}

export function applyPaperclipUiPatches(options = {}) {
  const root = options.root ?? join(homedir(), ".npm", "_npx");
  const files = findUiFiles(root);
  const warnings = [];
  if (files.length === 0) {
    warnings.push("Paperclip UI bundle was not found under ~/.npm/_npx");
    return { applied: 0, warnings };
  }
  let applied = 0;
  for (const replacement of replacements) {
    const targets = files.filter((path) => path.split("/").pop()?.startsWith(replacement.file));
    if (targets.length === 0) {
      warnings.push(`No ${replacement.file} bundle to patch`);
      continue;
    }
    let found = false;
    for (const target of targets) {
      const source = readFileSync(target, "utf8");
      const patched = patchBundleText(source, replacement);
      if (patched.status === "missing") continue;
      found = true;
      if (patched.status === "applied") {
        writeFileSync(target, patched.text);
        applied += 1;
      }
    }
    if (!found) warnings.push(`Patch marker missing in ${replacement.file}: ${replacement.from.slice(0, 80)}`);
  }
  const entryName = "index-ultimate-pi.js";
  const harnessName = "AiConnectionCredentialStep-ultimate-pi.js";
  const entry = files.find((path) => {
    const name = path.split("/").pop() ?? "";
    return name.startsWith("index-") && name.endsWith(".js") && name !== entryName;
  });
  const harness = files.find((path) => {
    const name = path.split("/").pop() ?? "";
    return name.startsWith("AiConnectionCredentialStep-") && name.endsWith(".js") && name !== harnessName;
  });
  if (!entry || !harness) {
    warnings.push("Could not copy patched bundles to cache-busting names");
    return { applied, warnings };
  }
  const assetDir = dirname(entry);
  const harnessFile = harness.split("/").pop();
  copyFileSync(harness, join(assetDir, harnessName));
  writeFileSync(join(assetDir, entryName), readFileSync(entry, "utf8").replaceAll(harnessFile, harnessName));
  const htmlPath = join(assetDir, "..", "index.html");
  try {
    const html = readFileSync(htmlPath, "utf8")
      .replace(/\/assets\/index-(?!ultimate-pi)[A-Za-z0-9_-]+\.js/g, `/assets/${entryName}`)
      .replace(/\/assets\/AiConnectionCredentialStep-(?!ultimate-pi)[A-Za-z0-9_-]+\.js/g, `/assets/${harnessName}`);
    writeFileSync(htmlPath, html);
  } catch (err) {
    warnings.push(err instanceof Error ? err.message : String(err));
  }
  return { applied, warnings };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const result = applyPaperclipUiPatches();
  for (const warning of result.warnings) console.error(warning);
  if (result.warnings.length > 0 && result.applied === 0) process.exit(1);
  console.log(`paperclip ui patches applied: ${result.applied}`);
}
