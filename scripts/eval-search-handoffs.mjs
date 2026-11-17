// Evaluate the handoff prior against sanitized notes or this repo's actual notebook.
// Embeddings remain local/cached. --answers explicitly sends synthetic medium records to Claude Code.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, buildVectorCache, createLocalProvider, execaRunner, loadAskEvalIndex,
  loadIndex, loadLlmProvider, loadProject, nodeFs, runAskEvalSet, search, searchHandoffPrior, semanticForQuery } from "../packages/core/dist/index.js";
import YAML from "../packages/core/node_modules/yaml/dist/index.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const notebook = process.argv.includes("--notebook");
const handoffPrior = 0.5;
const fixture = YAML.parse(readFileSync(join(root,"fixtures/evals/search-dogfood.yaml"),"utf8"));
const source = await loadProject(nodeFs,notebook ? root : join(root,"fixtures/projects/medium"));
const baseIndex = await loadIndex(source,{fs:nodeFs});
const overlay = fixture.records.map(r => ({file:`.aimem/${r.type === "handoff" ? "handoffs" : "memory"}/${r.id}-example.md`,dirType:r.type,
  text:`---\naimem: 1\nid: ${r.id}\ntype: ${r.type}\ntitle: ${r.title}\nsummary: ${r.summary}\nstatus: ${r.type === "handoff" ? "final" : "active"}\ntrust: agent\nroles: [dev]\nauthor: agent:fixture\ncreated: 2026-11-01T00:00:00Z\nupdated: 2026-11-01T00:00:00Z\n---\n${r.body}`}));
// Exclude the bug report quoting the exact search questions, which is not an answer note.
const index = notebook ? {...baseIndex,records:baseIndex.records.filter(r=>r.id !== "tsk-ewvajxqv")}
  : buildIndex([...baseIndex.records.map(r=>({file:r.file,dirType:r.type,text:r.text})),...overlay]);
const temp = mkdtempSync(join(tmpdir(),"aimem-search-eval-"));
try {
  const nb = {...source,dir:join(temp,".aimem")};
  const provider = await createLocalProvider({model:"auto",allowDownload:false,cacheDir:join(process.env.AIMEM_HOME ?? join(homedir(),".cache/aimem"),"models")});
  await buildVectorCache(nb,index,provider,{fs:nodeFs,random:{bytes:n=>crypto.getRandomValues(new Uint8Array(n))}});
  const cases = [];
  for (const c of [...fixture.cases,...(fixture.real_cases ?? [])]) {
    const semantic = await semanticForQuery(nb,index,provider,c.query,{fs:nodeFs});
    for (const mode of ["lexical","hybrid"]) {
      const after = search(index,c.query,{limit:index.records.length},mode === "hybrid" && semantic.scores ? semantic : undefined);
      // The production prior is applied after fusion, so removing it reconstructs the preceding order exactly.
      const before = after.map(h=>({...h,raw:h.raw / (h.record.type === "handoff" ? searchHandoffPrior(c.query) : 1)})).sort((a,b)=>b.raw-a.raw || a.record.id.localeCompare(b.record.id));
      const summary = hits => ({expectedRank:hits.findIndex(h=>h.record.id === c.expected)+1 || null,
        firstHandoffRank:hits.findIndex(h=>h.record.type === "handoff")+1 || null,
        top:hits.slice(0,4).map(h=>({ref:h.record.id,type:h.record.type}))});
      cases.push({id:c.id,mode,query:c.query,expected:c.expected,before:summary(before),after:summary(after)});
    }
  }
  const report = {corpus:notebook ? "aimem notebook without the self-referential bug report" : "medium plus sanitized dogfood notes",handoffPrior,cases};
  writeFileSync(join(root,`fixtures/evals/results/search-handoff-${notebook ? "notebook" : "medium"}.json`),JSON.stringify(report,null,2)+"\n");
  for (const c of cases) console.log(JSON.stringify({id:c.id,mode:c.mode,before:c.before.expectedRank,after:c.after.expectedRank,firstHandoffBefore:c.before.firstHandoffRank,firstHandoffAfter:c.after.firstHandoffRank}));
} finally {rmSync(temp,{recursive:true,force:true});}

if (process.argv.includes("--answers")) {
  delete process.env.ANTHROPIC_API_KEY;
  const set = YAML.parse(readFileSync(join(root,"fixtures/evals/ask-medium.yaml"),"utf8"));
  const nb = await loadProject(nodeFs,join(root,"fixtures/projects/medium"));
  const index = await loadAskEvalIndex(nb,nodeFs,join(root,"fixtures/evals",set.overlay));
  const status = loadLlmProvider({retrieval:{llm:{provider:"claude-cli",allow_remote:true,model:process.env.AIMEM_EVAL_MODEL || "sonnet",timeout_seconds:180}}},{runner:execaRunner(),env:process.env});
  if (!status.available) throw new Error(status.reason);
  await status.provider.generate({system:"Return READY only. No tools.",prompt:"READY",refCount:0});
  const llm = {...status.provider,generate:async req=>{const out=await status.provider.generate(req);process.stderr.write("Answer case completed\n");return out;}};
  const prior = JSON.parse(readFileSync(join(root,"fixtures/evals/results/ask-retrieval-options.json"),"utf8")).reports.find(r=>r.mode === "baseline");
  const after = await runAskEvalSet(nb,index,set,{llm});
  writeFileSync(join(root,"fixtures/evals/results/search-handoff-answers.json"),JSON.stringify({handoffPrior,beforeSummary:prior.summary,beforeReport:"ask-retrieval-options.json baseline",after},null,2)+"\n");
  console.log(JSON.stringify({before:prior.summary,after:after.summary}));
  if (after.summary.errors) throw new Error("Provider errors invalidate this comparison");
}
