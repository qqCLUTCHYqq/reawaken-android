import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {MANAGED_FILES,parseVersion} from '../ReAwaken/Android/update-policy.mjs';
import {crc32} from '../ReAwaken/Android/archive.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
export function zipBytes(files){
 const locals=[],central=[];let offset=0;
 for(const [name,bytes] of files){const n=Buffer.from(name),data=deflateRawSync(bytes),crc=(crc32(bytes)^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(n.length,26);locals.push(local,n,data);
  const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt16LE(20,4);dir.writeUInt16LE(20,6);dir.writeUInt16LE(8,10);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(data.length,20);dir.writeUInt32LE(bytes.length,24);dir.writeUInt16LE(n.length,28);dir.writeUInt32LE(offset,42);central.push(dir,n);offset+=local.length+n.length+data.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);
}
export async function packageApp(version){
 parseVersion(version);const source=path.join(import.meta.dirname,'../ReAwaken');const files=[];
 for(const name of MANAGED_FILES){let bytes;
  if(name==='READ-ME-FIRST.txt')bytes=Buffer.from('Re:Awaken Android '+version+' — PUBLIC BETA\nPhysical Android hardware remains unvalidated. You supply your own compatible KHUX 5.0.1 WW XAPK. No game files are included.\nSettings → Check for Updates. Beta channel is the default. Updates preserve settings and never change the Android game or OBBs. Updates are downloaded only from qqCLUTCHYqq/reawaken-android and SHA256 verified.\nExisting original Beta 1 users must install this updater-enabled build once; the original published executable cannot acquire an updater automatically.\nBackups/settings: %LOCALAPPDATA%\\ReAwaken\\Android. Retain this folder. If Windows blocks rollback, close the application and reopen it to recover; transaction backups are retained.\nFeedback: https://github.com/qqCLUTCHYqq/reawaken-android/issues\n');
  else if(name==='Android/app-version.json')bytes=Buffer.from(JSON.stringify({product:'ReAwaken.Android.Windows.x64',version,defaultChannel:parseVersion(version)[3]<2?'Beta':'Stable',updaterSchema:1}));
  else if(name==='Android/beta-version.mjs')bytes=Buffer.from(`export const BETA_VERSION='${version}';\nexport const BETA_NAME='Re:Awaken Android ${version.includes('-beta.')?'Beta '+version.split('-beta.')[1]:version}';\nexport const FEEDBACK_URL='https://github.com/qqCLUTCHYqq/reawaken-android/issues';\n`);
  else bytes=await fs.readFile(path.join(source,name==='ReAwaken-Android-Beta.exe'?'Android/'+name:name));
  files.push([name,bytes]);
 }
 const manifest={schema:1,product:'ReAwaken.Android.Windows.x64',version,files:files.map(([name,b])=>({path:name,sha256:digest(b)}))};files.push(['update-manifest.json',Buffer.from(JSON.stringify(manifest,null,2))]);return zipBytes(files);
}
if(process.argv[1]===import.meta.filename){const version=process.argv[2]||'1.0.0-beta.1',filename=process.argv[3]||path.join(import.meta.dirname,'../build/ReAwaken-Android-Updater-Preview-Windows-x64.zip');const bytes=await packageApp(version);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,bytes);await fs.writeFile(filename+'.sha256',digest(bytes)+'  '+path.basename(filename)+'\n');console.log(JSON.stringify({filename,sha256:digest(bytes),bytes:bytes.length}));}
