import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, cp, readFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { listProjects } from '../plugins/source-control-proof/projects.mjs';
import { readCodexProjects } from '../plugins/source-control-proof/codex-projects.mjs';
import { handle } from '../plugins/source-control-proof/server.mjs';
const root = await mkdtemp(join(tmpdir(), 'codex-source-control-discovery-'));
const oldHome = process.env.CODEX_HOME;
let db, child;
try {
  const home = join(root,'profile'); await mkdir(home); process.env.CODEX_HOME = home;
  const roots = [join(root,'desktop checkout'),join(root,'website checkout')];
  for (const [i,path] of roots.entries()) {
    await mkdir(path); execFileSync('git',['-C',path,'init','-b','branch-'+i]);
  }
  // Old JSON deliberately disagrees: the current SQLite catalog must win.
  await writeFile(join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{old:{name:'Outdated',rootPaths:[roots[0]]}}}));
  db = new DatabaseSync(join(home,'state_42.sqlite'));
  db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, position INTEGER); CREATE TABLE project_roots (project_id TEXT, position INTEGER, path TEXT);');
  db.prepare('INSERT INTO projects VALUES (?,?,?)').run('fixture','Multi-repository project',0);
  for (const [i,path] of roots.entries()) db.prepare('INSERT INTO project_roots VALUES (?,?,?)').run('fixture',i,path);
  let catalog = await listProjects();
  assert.equal(catalog.discovery.source,'Codex local project database');
  assert.equal(catalog.projects.length,2);
  assert.deepEqual(catalog.projects.map(p=>p.checkouts[0].branch),['branch-0','branch-1']);
  assert(catalog.projects.every(p=>p.label.startsWith('Multi-repository project · ')));
  // External edits to Codex data appear on the very next request.
  db.prepare('UPDATE projects SET name=?').run('Renamed project');
  db.prepare('DELETE FROM project_roots WHERE position=1').run();
  catalog = await listProjects(); assert.equal(catalog.projects.length,1);
  assert.equal(catalog.projects[0].label,'Renamed project');
  db.prepare('DELETE FROM projects').run(); db.prepare('DELETE FROM project_roots').run();
  assert.equal((await listProjects()).projects.length,0); // No stale JSON fallback for empty DB.
  db.close(); db = null; await rm(join(home,'state_42.sqlite'));
  assert.equal((await listProjects()).projects[0].label,'Outdated');
  await writeFile(join(home,'.codex-global-state.json'),JSON.stringify({'local-projects':{a:{name:'Legacy multi-root',rootPaths:roots}}}));
  assert.equal((await listProjects()).projects.length,2);
  await rm(join(home,'.codex-global-state.json'));
  assert((await readCodexProjects()).warning);
  assert((await handle('tools/call',{name:'source_control_panel'})).structuredContent.needsCheckout);
  await assert.rejects(handle('tools/call',{name:'git_status'}),/Choose a repository/);
  process.env.SOURCE_CONTROL_TEST_REPO = roots[0];
  await assert.rejects(handle('tools/call',{name:'git_status',arguments:{repoPath:home}}),/No Git checkout/);
  delete process.env.SOURCE_CONTROL_TEST_REPO;
  // Launch exactly the portable manifest command from a different folder with spaces.
  const relocated = join(root,'relocated plugin');
  await cp(fileURLToPath(new URL('../plugins/source-control-proof', import.meta.url)),relocated,{recursive:true});
  const config = JSON.parse(await readFile(join(relocated,'.mcp.json'),'utf8')).mcpServers['source-control-proof'];
  assert.equal(config.command,'node'); assert.equal(config.cwd,'.');
  child=spawn(config.command,config.args,{cwd:resolve(relocated,config.cwd),env:{...process.env}});
  let id=0; const pending=new Map();
  createInterface({input:child.stdout}).on('line',line=>{const msg=JSON.parse(line);pending.get(msg.id)?.(msg);pending.delete(msg.id)});
  const rpc=(method,params)=>new Promise((res,rej)=>{
    const next=++id; const timer=setTimeout(()=>rej(new Error('RPC timeout')),5000);
    pending.set(next,msg=>{clearTimeout(timer);res(msg)});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');
  });
  const manifest = JSON.parse(await readFile(join(relocated,'.codex-plugin/plugin.json'),'utf8'));
  assert.equal((await rpc('initialize')).result.serverInfo.version,manifest.version);
  assert((await rpc('tools/call',{name:'source_control_panel'})).result.structuredContent.needsCheckout);
  assert.equal((await rpc('tools/call',{name:'git_status',arguments:{repoPath:roots[1]}})).result.structuredContent.branch,'branch-1');
  console.log('PASS: live multi-root catalog, external rename/removal, authoritative empty database, legacy discovery, unavailable catalog, no implicit fallback, relocated portable MCP launch.');
} finally {
  db?.close(); child?.kill();
  if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME=oldHome;
  await rm(root,{recursive:true,force:true});
}
