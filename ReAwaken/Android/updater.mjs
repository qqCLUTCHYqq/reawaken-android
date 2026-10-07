import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Zip} from './archive.mjs';
import {sha256} from '../Common/hash.mjs';
import {MANAGED_FILES,REPOSITORY,compareVersions,selectRelease,parseVersion} from './update-policy.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function exists(p){try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(p){return JSON.parse(await fs.readFile(p,'utf8'));}
async function atomic(p,value){await fs.mkdir(path.dirname(p),{recursive:true});const temp=p+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,p);}
async function replaceFile(source,dest){const temp=dest+'.reawaken-'+randomUUID()+'.tmp';try{await fs.copyFile(source,temp);await fs.rename(temp,dest);}finally{if(await exists(temp))await fs.unlink(temp);}}
async function safePath(root,relative){
 if(!MANAGED_FILES.includes(relative))throw Error('Not an Android application file');
 let current=path.resolve(root);for(const part of relative.split('/')){current=path.join(current,part);if(await exists(current)){const s=await fs.lstat(current);if(s.isSymbolicLink()||s.nlink>1&&!s.isDirectory())throw Error('Linked application path refused');}}
 return current;
}
async function normalRoot(root){root=path.resolve(root);if(await fs.realpath(root)!==root)throw Error('Linked install directory refused');return root;}
export async function check(installed,channel,request=fetch){
 const releases=[];
 for(let page=1;page<=10;page++){
  const response=await request(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'ReAwaken-Android-Updater'},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw Error('Android release check failed ('+response.status+')');const list=await response.json();if(!Array.isArray(list))throw Error('Invalid Android release feed');releases.push(...list);if(list.length<100)break;
 }
 return {installed,channel,update:selectRelease(releases,installed,channel)};
}
export async function stage(root,state,channel,request=fetch){
 root=await normalRoot(root);const current=await json(path.join(root,'Android/app-version.json'));
 const found=await check(current.version,channel,request);if(!found.update)throw Error('No newer Android release');const update=found.update;
 const session=path.join(state,'updates',randomUUID());await fs.mkdir(session,{recursive:true});
 const zipFile=path.join(session,'download.zip');
 const response=await request(update.url,{signal:AbortSignal.timeout(600000)});if(!response.ok)throw Error('Android update download failed');
 const output=await fs.open(zipFile,'wx');let total=0;
 try{for await(const chunk of response.body){total+=chunk.length;if(total>update.bytes)throw Error('Update download size exceeded');await output.writeFile(chunk);}}finally{await output.close();}
 if(total!==update.bytes||await sha256(zipFile)!==update.sha256)throw Error('Update SHA256 verification failed; nothing installed');
 const zip=await Zip.load(zipFile);const staged=path.join(session,'staged');await fs.mkdir(staged);
 try{
  const names=zip.entries.map(e=>e.name);
  if(names.length!==new Set(names.map(x=>x.toLowerCase())).size)throw Error('Case-colliding update paths');
  if(names.some(x=>x!=='update-manifest.json'&&!MANAGED_FILES.includes(x)))throw Error('Update contains files outside the Android application');
  const manifest=JSON.parse((await zip.bytes(zip.entries.find(e=>e.name==='update-manifest.json'),1024*1024)).toString());
  if(manifest.schema!==1||manifest.product!=='ReAwaken.Android.Windows.x64'||manifest.version!==update.version||!Array.isArray(manifest.files))throw Error('Wrong Android update package');
  if(manifest.files.length!==MANAGED_FILES.length||new Set(manifest.files.map(x=>x.path)).size!==MANAGED_FILES.length||names.length!==MANAGED_FILES.length+1)throw Error('Incomplete Android update package');
  let expanded=0;
  for(const file of manifest.files){
   if(!MANAGED_FILES.includes(file.path)||!/^([a-f0-9]{64})$/.test(file.sha256))throw Error('Invalid application manifest');
   const entry=zip.entries.find(e=>e.name===file.path);if(!entry||entry.bytes<1||(expanded+=entry.bytes)>512*1024*1024)throw Error('Invalid expanded update size');
   await zip.extract(entry,path.join(staged,file.path));if(await sha256(path.join(staged,file.path))!==file.sha256)throw Error('Application file integrity failed');
   await safePath(root,file.path);
  }
  const version=await json(path.join(staged,'Android/app-version.json'));if(version.version!==update.version||version.product!==manifest.product)throw Error('Installed version metadata mismatch');
  // Copy the CURRENT trusted helper/runtime outside the installation so locked EXE/runtime files can be replaced.
  for(const name of ['Android/updater.mjs','Android/update-policy.mjs','Android/archive.mjs','Common/hash.mjs','Android/runtime/node.exe']){await fs.mkdir(path.dirname(path.join(session,'helper',name)),{recursive:true});await fs.copyFile(path.join(root,name),path.join(session,'helper',name));}
  const plan={schema:1,root,state,session,version:update.version,token:randomUUID(),files:manifest.files,applied:[],status:'staged'};
  await atomic(path.join(session,'plan.json'),plan);
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  await fs.writeFile(path.join(session,'Recover-Android.ps1'),`$ErrorActionPreference='Stop'\n& ${quote(path.join(session,'helper/Android/runtime/node.exe'))} ${quote(path.join(session,'helper/Android/updater.mjs'))} recover ${quote(state)}\nif($LASTEXITCODE -ne 0){throw 'Recovery stopped; retained backup was not discarded.'}\nStart-Process -FilePath ${quote(path.join(root,'ReAwaken-Android-Beta.exe'))}\n`);
  return {plan:path.join(session,'plan.json'),node:path.join(session,'helper/Android/runtime/node.exe'),helper:path.join(session,'helper/Android/updater.mjs'),version:update.version};
 }finally{await zip.close();}
}
async function validatePlan(planFile){
 const p=await json(planFile);p.root=await normalRoot(p.root);
 if(p.schema!==1||path.resolve(planFile)!==path.join(p.session,'plan.json')||path.dirname(p.session)!==path.join(p.state,'updates')||!Array.isArray(p.files)||p.files.length!==MANAGED_FILES.length)throw Error('Invalid update transaction');
 parseVersion(p.version);const names=new Set();for(const f of p.files){await safePath(p.root,f.path);if(names.has(f.path)||!/^([a-f0-9]{64})$/.test(f.sha256))throw Error('Invalid update file');names.add(f.path);}
 if(!Array.isArray(p.applied)||p.applied.some(x=>!names.has(x.path)))throw Error('Invalid transaction journal');return p;
}
async function rollback(p,planFile){
 p.status='rolling-back';await atomic(planFile,p);
 for(const record of [...p.applied].reverse()){
  const dest=await safePath(p.root,record.path),backup=path.join(p.session,'backup',record.path);
  if(record.existed){if(await sha256(backup)!==record.originalHash)throw Error('Rollback backup damaged; backup retained');await replaceFile(backup,dest);}
  else if(await exists(dest)){// Remove only a file created by this transaction, with matching update bytes.
   if(await sha256(dest)!==p.files.find(f=>f.path===record.path).sha256)throw Error('New application file changed; rollback retained');await fs.unlink(dest);
  }
 }
 p.status='rolled-back';await atomic(planFile,p);
}
export async function recover(planFile){const p=await validatePlan(planFile);if(['applying','awaiting-health','rolling-back'].includes(p.status))await rollback(p,planFile);return p.status;}
export async function apply(planFile,{waitForParent=async()=>{},launch,healthTimeout=45000}={}){
 const p=await validatePlan(planFile);if(p.status!=='staged')throw Error('Transaction already started');await waitForParent();
 const lock=path.join(p.root,'.reawaken-update.lock');let handle;
 try{handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,plan:planFile}));}catch{throw Error('Another Android update requires recovery');}
 let child;
 try{
  // Recheck every staged byte immediately before applying. No ADB commands are used here.
  for(const f of p.files)if(await sha256(path.join(p.session,'staged',f.path))!==f.sha256)throw Error('Staged update changed');
  const installed=await json(path.join(p.root,'Android/app-version.json'));if(compareVersions(p.version,installed.version)<=0)throw Error('Downgrade refused');
  p.status='applying';await atomic(planFile,p);
  for(const f of [...p.files].sort((a,b)=>(a.path==='ReAwaken-Android-Beta.exe')-(b.path==='ReAwaken-Android-Beta.exe'))){
   const dest=await safePath(p.root,f.path),backup=path.join(p.session,'backup',f.path),existed=await exists(dest);
   let originalHash=null;if(existed){originalHash=await sha256(dest);await fs.mkdir(path.dirname(backup),{recursive:true});await fs.copyFile(dest,backup);if(await sha256(backup)!==originalHash)throw Error('Backup integrity failed');}
   p.applied.push({path:f.path,existed,originalHash});await atomic(planFile,p);await fs.mkdir(path.dirname(dest),{recursive:true});
   await replaceFile(path.join(p.session,'staged',f.path),dest);if(await sha256(dest)!==f.sha256)throw Error('Installed file integrity failed');
  }
  p.status='awaiting-health';await atomic(planFile,p);
  child=await launch(p);p.launchedPid=child?.pid||null;await atomic(planFile,p);
  const health=path.join(p.session,'health.json'),deadline=Date.now()+healthTimeout;let acknowledged=false;
  while(Date.now()<deadline){if(await exists(health)){const ack=await json(health);acknowledged=ack.token===p.token&&ack.version===p.version;if(acknowledged)break;}await sleep(100);}
  if(!acknowledged)throw Error('Updated application did not start successfully');
  p.status='complete';await atomic(planFile,p);child?.unref();return {status:p.status,version:p.version};
 }catch(error){
  if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,5000);}});}
  if(p.applied.length)await rollback(p,planFile);
  p.error='UPDATE_FAILED_OLD_VERSION_RESTORED';await atomic(planFile,p);throw error;
 }finally{await handle.close();await fs.unlink(lock);}
}
export async function health(planFile,root,token){
 const p=await validatePlan(planFile);if(p.status!=='awaiting-health'||p.root!==path.resolve(root)||p.token!==token)throw Error('Invalid startup acknowledgement');
 for(const f of p.files)if(await sha256(await safePath(p.root,f.path))!==f.sha256)throw Error('Startup integrity check failed');
 await atomic(path.join(p.session,'health.json'),{token,version:p.version});
}
async function cli(){
 const [command,...args]=process.argv.slice(2);
 if(command==='check')console.log(JSON.stringify(await check(args[0],args[1])));
 else if(command==='stage')console.log(JSON.stringify(await stage(args[0],args[1],args[2])));
 else if(command==='health'){await health(args[0],args[1],args[2]);console.log('{}');}
 else if(command==='recover'){const state=args[0];let recovered=false;const updates=path.join(state,'updates');if(await exists(updates))for(const entry of await fs.readdir(updates,{withFileTypes:true})){if(!entry.isDirectory())continue;const plan=path.join(updates,entry.name,'plan.json');if(await exists(plan)){const p=await validatePlan(plan);if(['applying','awaiting-health','rolling-back'].includes(p.status)){const lock=path.join(p.root,'.reawaken-update.lock');if(await exists(lock)){const owner=await json(lock);try{process.kill(owner.pid,0);throw Error('Update helper still running');}catch(e){if(e.code!=='ESRCH')throw e;}}await recover(plan);if(await exists(lock))await fs.unlink(lock);recovered=true;}}}console.log(JSON.stringify({recovered}));}
 else if(command==='apply'){
  const pid=Number(args[1]);if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid launcher process');
  const launch=async p=>{const child=spawn(path.join(p.root,'ReAwaken-Android-Beta.exe'),['--update-health',path.join(p.session,'plan.json'),p.token],{cwd:p.root,windowsHide:false,detached:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});return child;};
  try{await apply(args[0],{waitForParent:async()=>{const end=Date.now()+120000;while(true){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return;throw e;}if(Date.now()>end)throw Error('Application still running; nothing replaced');await sleep(200);}},launch});}
  catch(error){const p=await json(args[0]);if(p.status==='rolled-back')spawn(path.join(p.root,'ReAwaken-Android-Beta.exe'),['--update-rolled-back'],{cwd:p.root,detached:true,stdio:'ignore'}).unref();throw error;}
 }else throw Error('Unknown updater operation');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli().catch(()=>{console.error('ANDROID_UPDATE_FAILED: No game or device files were changed. Check the local update transaction and retained backup.');process.exitCode=1;});
