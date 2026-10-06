import {sha256} from '../Common/hash.mjs';
import {PACKAGE,ACTIVITY,OBB_DIR,inspectApk,bgad} from './validate.mjs';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {profilePath} from './validate.mjs';
import {companionSession} from './companion.mjs';

export async function preflight(adb,prepared,{companionArtifact=null}={}) {
  await adb.select(adb.serial);
  if(!/^uid=2000\(shell\)/.test(await adb.run(['shell','id'])))throw Error('Normal non-root ADB shell required for the user installation workflow');
  // Revalidate files at execution time; never trust an edited saved plan.
  const profile=JSON.parse(await readFile(profilePath,'utf8'));
  const m=await inspectApk(prepared.apk);
  if(m.sha256!==profile.apk.sha256||m.bytes!==profile.apk.bytes)throw Error('APK baseline mismatch');
  if(prepared.content.length!==2)throw Error('Missing OBBs');
  const names=new Set();
  for(const c of prepared.content) {
    const target=profile.content.find(e=>e.name===c.name);
    if(!target||names.has(c.name)||await sha256(c.file)!==target.sha256||(await stat(c.file)).size!==target.bytes)throw Error('OBB baseline mismatch');
    names.add(c.name);await bgad(c.file);
    c.sha256=target.sha256;c.bytes=target.bytes;
    c.destination=`${OBB_DIR}/${target.name}`;
  }
  const device=await adb.properties();
  if(!Number.isInteger(device.sdk)||device.sdk<m.minSdk||!device.abis.some(a=>m.architectures.includes(a)))throw Error('Device SDK/CPU incompatible');
  const user=await adb.run(['shell','am','get-current-user']);
  if(user!=='0')throw Error('Prototype supports primary Android user 0 only');
  const packages=await adb.run(['shell','pm','list','packages',PACKAGE]);
  if(packages.split(/\r?\n/).includes(`package:${PACKAGE}`))throw Error('Game already installed. Stop to protect saves; update/import is deferred.');
  await adb.run(['shell','ls','-d','/sdcard/Android/obb','/sdcard/Android/data']);
  const exists=await adb.run(['shell','test','-e',OBB_DIR,'&&','echo','EXISTS','||','echo','ABSENT']);
  if(exists!=='ABSENT')throw Error('Existing OBB directory or storage access problem; stop to protect content');
  const dataDir=`/sdcard/Android/data/${PACKAGE}`;
  const dataExists=await adb.run(['shell','test','-e',dataDir,'&&','echo','EXISTS','||','echo','ABSENT']);
  if(dataExists!=='ABSENT')throw Error('Existing external game data; stop to protect saves');
  const writable=await adb.run(['shell','test','-w','/sdcard/Android/obb','&&','echo','WRITABLE','||','echo','BLOCKED']);
  const contentRoute=writable==='WRITABLE'?'adb':'installer-companion';
  if(contentRoute==='installer-companion'&&(!companionArtifact||device.sdk<26))throw Error('This Android firmware blocks normal ADB OBB placement. Use the verified Re:Awaken installer companion on Android 8+; root is not a supported solution.');
  const disk=await adb.run(['shell','df','-k','/sdcard','/data']);
  const rows=disk.split(/\r?\n/).slice(1).map(l=>l.trim().split(/\s+/)).filter(r=>r.length>=6);
  const required=profile.content.reduce((n,c)=>n+c.bytes,0)+profile.apk.bytes*3+512*1024**2;
  if(!rows.length||rows.some(r=>!Number.isFinite(Number(r[3]))||Number(r[3])*1024<required))throw Error('Insufficient or unverified device free space');
  return {device,packageInfo:m,requiredFreeBytes:required,contentRoute};
}
export async function install(adb,prepared,{launch=false,companionArtifact=null,onProgress=()=>{}}={}) {
  const checked=await preflight(adb,prepared,{companionArtifact});
  onProgress({phase:'preflight-passed',route:checked.contentRoute});
  if(checked.contentRoute==='adb'){
    try{await probeAdbContent(adb,prepared.stage||path.dirname(prepared.apk));}
    catch(e){
      if(!companionArtifact||checked.device.sdk<26)throw Error(`Non-root content probe failed before APK install: ${e.message}. Verified installer companion required on supported Android 8+ firmware.`);
      checked.contentRoute='installer-companion';onProgress({phase:'fallback',detail:'Normal ADB content access failed; using the user-authorized Android installer companion.'});
    }
  }
  const installApk=async()=>{
    onProgress({phase:'installing-apk',detail:'Installing the validated original APK'});
    const installed=await adb.run(['install','--no-streaming',prepared.apk],{timeout:300000});
    if(!/^Success\s*$/m.test(installed))throw Error(`APK install did not report Success: ${installed}`);
  };
  let content;
  if(checked.contentRoute==='installer-companion')content=await companionSession(adb,prepared,{artifact:companionArtifact,installApk,onProgress});
  else {await installApk();onProgress({phase:'placing-content'});await placeContent(adb,prepared);content={route:'adb',nonRoot:true,contentVerified:true};}
  onProgress({phase:'content-verified'});
  const installedPath=await adb.run(['shell','pm','path',PACKAGE]);
  const dumpsys=await adb.run(['shell','dumpsys','package',PACKAGE]);
  if(!installedPath.startsWith('package:')||!/versionCode=87\b/.test(dumpsys)||!/versionName=5\.0\.1\b/.test(dumpsys))throw Error('Installed package/version verification failed');
  let launched=false;
  if(launch) {
    onProgress({phase:'launching-game'});
    const result=await adb.run(['shell','am','start','-W','-n',`${PACKAGE}/${ACTIVITY}`]);
    if(!/Status: ok/.test(result)||/Error:|Exception/.test(result))throw Error('Launch failed');launched=true;
  }
  return {...checked,...content,installedPath,contentVerified:true,launched,offlineGameplayVerified:false};
}
export const PROBE_BYTES=Buffer.from('ReAwaken-OBB-Probe-v1');
export const PROBE_SHA256=createHash('sha256').update(PROBE_BYTES).digest('hex');
export async function probeAdbContent(adb,stage){
  const name=`.reawaken-probe-${randomUUID()}`;
  const local=path.join(stage,name),remote=`${OBB_DIR}/${name}`,renamed=`${remote}.verified`;
  await writeFile(local,PROBE_BYTES,{flag:'wx'});let created=false;
  try{
    // No -p: an unexpected existing directory is never adopted or emptied.
    await adb.run(['shell','mkdir',OBB_DIR]);created=true;
    await adb.run(['push',local,remote]);
    if((await adb.run(['shell','toybox','sha256sum',remote])).split(/\s+/)[0]!==PROBE_SHA256)throw Error('Probe hash mismatch');
    await adb.run(['shell','mv',remote,renamed]);
    if((await adb.run(['shell','toybox','sha256sum',renamed])).split(/\s+/)[0]!==PROBE_SHA256)throw Error('Renamed probe hash mismatch');
  }finally{
    if(created){await adb.run(['shell','rm','-f',remote,renamed]);await adb.run(['shell','rmdir',OBB_DIR]);}
  }
}
// Shared placement routine also exercised by the isolated emulator validation harness.
// It never elevates ADB or changes device permissions.
export async function placeContent(adb,prepared) {
  const profile=JSON.parse(await readFile(profilePath,'utf8'));
  if(prepared.content.length!==profile.content.length)throw Error('Missing OBBs');
  const seen=new Set();
  for(const c of prepared.content) {
    const target=profile.content.find(e=>e.name===c.name);
    if(!target||seen.has(c.name)||(await stat(c.file)).size!==target.bytes||await sha256(c.file)!==target.sha256)throw Error('OBB baseline mismatch');
    seen.add(c.name);c.sha256=target.sha256;c.destination=`${OBB_DIR}/${target.name}`;
  }
  await adb.run(['shell','mkdir','-p',OBB_DIR]);
  for(const c of prepared.content) {
    const temp=`${c.destination}.reawaken-${randomUUID()}.part`;
    const existing=await adb.run(['shell','test','-e',c.destination,'&&','echo','EXISTS','||','echo','ABSENT']);
    if(existing!=='ABSENT')throw Error('Existing content; preserving it rather than replacing it');
    await adb.run(['push',c.file,temp],{timeout:900000});
    const sum=await adb.run(['shell','toybox','sha256sum',temp],{timeout:300000});
    if(sum.split(/\s+/)[0]!==c.sha256)throw Error('Device OBB hash mismatch; incomplete file left for diagnosis');
    // -n prevents replacement if another installer creates the target mid-transfer.
    await adb.run(['shell','mv','-n',temp,c.destination]);
    const final=await adb.run(['shell','toybox','sha256sum',c.destination],{timeout:300000});
    if(final.split(/\s+/)[0]!==c.sha256)throw Error('Final OBB verification failed');
  }
}
