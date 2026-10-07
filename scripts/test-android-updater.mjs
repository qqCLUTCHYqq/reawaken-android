import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {packageApp,zipBytes} from './package-android-desktop.mjs';
import {Zip} from '../ReAwaken/Android/archive.mjs';
import {selectRelease,REPOSITORY,MANAGED_FILES} from '../ReAwaken/Android/update-policy.mjs';
import {stage,apply,recover} from '../ReAwaken/Android/updater.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const dir=path.join(import.meta.dirname,'../build/updater-validation-'+Date.now()),state=path.join(dir,'state');await fs.mkdir(state,{recursive:true});
const preferences={xapkLocation:path.join(dir,'private-user-game.xapk'),devicePreference:'preferred-device',updateChannel:'Beta',sdkTermsAccepted:true,diagnostics:{enabled:false},futureSaveEditor:{backups:'preserve-me'}};
await fs.writeFile(path.join(state,'settings.json'),JSON.stringify(preferences));await fs.writeFile(preferences.xapkLocation,'LOCAL SYNTHETIC SENTINEL, NOT GAME CONTENT');await fs.mkdir(path.join(state,'save-backups'));await fs.writeFile(path.join(state,'save-backups','sentinel'),'future backups unchanged');
const before=await fs.readFile(path.join(state,'settings.json'));const sentinel=await fs.readFile(preferences.xapkLocation);
const beta1=await packageApp('1.0.0-beta.1'),beta2=await packageApp('1.0.0-beta.2');let download=beta2;
function release(version,bytes,prerelease=true){const tag='reawaken-android-v'+version,name='ReAwaken-Android-'+version+'-Windows-x64.zip';return {tag_name:tag,name:'Local simulated Android '+version,body:'LOCAL TEST ONLY — never published',draft:false,prerelease,assets:[{name,state:'uploaded',browser_download_url:`https://github.com/${REPOSITORY}/releases/download/${tag}/${name}`,digest:'sha256:'+hash(bytes),size:bytes.length}]};}
let releases=[release('1.0.0-beta.2',beta2)];
assert.equal(selectRelease(releases,'1.0.0-beta.1','Beta').version,'1.0.0-beta.2');assert.equal(selectRelease(releases,'1.0.0-beta.1','Stable'),null);
assert.equal(selectRelease([release('1.0.0',beta2,false)],'1.0.0-beta.1','Stable').version,'1.0.0');
assert.equal(selectRelease([release('1.0.0-beta.2',beta2)],'1.0.0-beta.2','Beta'),null);
const wrong=release('1.0.0-beta.2',beta2);wrong.assets[0].browser_download_url=wrong.assets[0].browser_download_url.replace('reawaken-android','reawaken-ios');assert.equal(selectRelease([wrong],'1.0.0-beta.1','Beta'),null);
const missing=release('1.0.0-beta.2',beta2);delete missing.assets[0].digest;assert.equal(selectRelease([missing],'1.0.0-beta.1','Beta'),null);
const server=createServer((req,res)=>{if(req.url==='/feed'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(releases));}else res.end(download);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const request=(url,opts)=>{assert(url.includes(REPOSITORY));return fetch(`http://127.0.0.1:${server.address().port}/${url.includes('api.github.com')?'feed':'zip'}`,opts);};
async function installation(name){const root=path.join(dir,name);await fs.mkdir(root);const file=path.join(dir,name+'.zip');await fs.writeFile(file,beta1);const zip=await Zip.load(file);try{for(const e of zip.entries)await zip.extract(e,path.join(root,e.name));}finally{await zip.close();}await fs.mkdir(path.join(root,'Android/runtime-cache'));await fs.writeFile(path.join(root,'Android/runtime-cache','keep'),'original cache untouched');await fs.writeFile(path.join(root,'unrelated.txt'),'keep unrelated');return root;}
async function unchanged(root){assert.deepEqual(await fs.readFile(path.join(state,'settings.json')),before);assert.deepEqual(await fs.readFile(preferences.xapkLocation),sentinel);assert.equal(await fs.readFile(path.join(state,'save-backups','sentinel'),'utf8'),'future backups unchanged');assert.equal(await fs.readFile(path.join(root,'Android/runtime-cache','keep'),'utf8'),'original cache untouched');assert.equal(await fs.readFile(path.join(root,'unrelated.txt'),'utf8'),'keep unrelated');}
async function helper(prepared){const child=spawn(prepared.node,[prepared.helper,'apply',prepared.plan,'1073741800'],{windowsHide:true,env:{...process.env,REAWAKEN_ANDROID_LOCAL_TEST_STATE:state},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',b=>err+=b);return await new Promise(resolve=>child.once('exit',code=>resolve({code,err})));}
let root;
try{
 root=await installation('success');const prepared=await stage(root,state,'Beta',request);const result=await helper(prepared);assert.equal(result.code,0,result.err);
 const plan=JSON.parse(await fs.readFile(prepared.plan));assert.equal(plan.status,'complete');assert.equal(JSON.parse(await fs.readFile(path.join(root,'Android/app-version.json'))).version,'1.0.0-beta.2');await unchanged(root);
 // Close only the application started by this update test (its exact PID is journaled by the helper).
 const health=JSON.parse(await fs.readFile(path.join(plan.session,'health.json')));assert.equal(health.version,'1.0.0-beta.2');if(plan.launchedPid)process.kill(plan.launchedPid);
 const badRoot=await installation('wrong-hash');download=Buffer.from(beta2);download[20]^=255;await assert.rejects(stage(badRoot,state,'Beta',request),/SHA256/);await unchanged(badRoot);assert.equal(JSON.parse(await fs.readFile(path.join(badRoot,'Android/app-version.json'))).version,'1.0.0-beta.1');download=beta2;
 const forbidden=zipBytes([['Android/runtime-cache/user.xapk',Buffer.from('not allowed')]]);download=forbidden;releases=[release('1.0.0-beta.2',forbidden)];await assert.rejects(stage(badRoot,state,'Beta',request),/outside/);download=beta2;releases=[release('1.0.0-beta.2',beta2)];
 const failRoot=await installation('startup-failure'),failed=await stage(failRoot,state,'Beta',request);await assert.rejects(apply(failed.plan,{launch:async()=>null,healthTimeout:250}),/did not start/);assert.equal(JSON.parse(await fs.readFile(failed.plan)).status,'rolled-back');assert.equal(JSON.parse(await fs.readFile(path.join(failRoot,'Android/app-version.json'))).version,'1.0.0-beta.1');await unchanged(failRoot);
 // Simulate power loss after a partial replacement, then exercise durable recovery.
 const crashRoot=await installation('interrupted'),crash=await stage(crashRoot,state,'Beta',request);const journal=JSON.parse(await fs.readFile(crash.plan)),file='Android/app-version.json',old=await fs.readFile(path.join(crashRoot,file));await fs.mkdir(path.join(journal.session,'backup/Android'),{recursive:true});await fs.writeFile(path.join(journal.session,'backup',file),old);await fs.copyFile(path.join(journal.session,'staged',file),path.join(crashRoot,file));journal.status='applying';journal.applied=[{path:file,existed:true,originalHash:hash(old)}];await fs.writeFile(crash.plan,JSON.stringify(journal));assert.equal(await recover(crash.plan),'rolled-back');assert.deepEqual(await fs.readFile(path.join(crashRoot,file)),old);await unchanged(crashRoot);
 const report={result:'PASS',from:'1.0.0-beta.1 (updater-enabled local build)',to:'1.0.0-beta.2 (local simulated release)',detected:true,downloaded:true,publishedSha256Verified:true,realWindowsHelperReplacement:true,realWindowsApplicationRelaunched:true,startupHealthVerified:true,settingsXapkDeviceDiagnosticsFutureBackupsPreserved:true,hashFailureRejected:true,wrongRepositoryRejected:true,unmanagedPathsRejected:true,startupFailureRolledBack:true,interruptedTransactionRecovered:true,gameFilesModified:false,iosModified:false,publicTestReleaseCreated:false,workspace:dir};await fs.writeFile(path.join(import.meta.dirname,'../build/Android-Updater-Test-Report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{server.close();}
