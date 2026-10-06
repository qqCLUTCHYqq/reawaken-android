import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Zip} from './archive.mjs';
import {sha256} from '../Common/hash.mjs';

const URL='https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip';
const SIZE=8044989;
const SHA1='e03e78b1d80b396f1c3358e31251cb31740e1110';
const SHA256='45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99';
export async function obtainAdb(directory,{acceptSdkTerms=false}={}) {
  if(process.platform!=='win32')throw Error('Tool download prototype currently supports Windows only');
  await mkdir(directory,{recursive:true});
  const receiptPath=path.join(directory,'receipt.json');
  try {
    const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
    if(receipt.url!==URL||receipt.acceptedSdkTerms!==true)throw Error('Tool receipt mismatch');
    if(!/^platform-[A-Za-z0-9]{6}\/platform-tools\/adb\.exe$/.test(receipt.adb.replaceAll('\\','/')))throw Error('Invalid cached tool path');
    const cachedStage=path.dirname(path.dirname(path.join(directory,receipt.adb)));
    const cachedArchive=path.join(cachedStage,'download.zip');
    if(await sha256(cachedArchive)!==SHA256)throw Error('Cached archive changed');
    const cachedZip=await Zip.load(cachedArchive);
    try {for(const entry of cachedZip.entries.filter(e=>!e.name.endsWith('/'))) {
      const expected=createHash('sha256').update(await cachedZip.bytes(entry)).digest('hex');
      if(await sha256(path.join(cachedStage,entry.name))!==expected)throw Error('Cached tool changed');
    }}finally{await cachedZip.close();}
    return path.join(directory,receipt.adb);
  }catch(e){if(e.code!=='ENOENT')throw e;}
  if(!acceptSdkTerms)throw Error('Accept https://developer.android.com/studio/terms before downloading SDK tooling');
  const response=await fetch(URL,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`ADB download HTTP ${response.status}`);
  const b=Buffer.from(await response.arrayBuffer());
  if(b.length!==SIZE||createHash('sha1').update(b).digest('hex')!==SHA1||createHash('sha256').update(b).digest('hex')!==SHA256)throw Error('Google archive checksum mismatch');
  // Google repository2-1.xml checksum additionally pinned here; do not redistribute SDK ZIP.
  const stage=await mkdtemp(path.join(directory,'platform-'));
  const archive=path.join(stage,'download.zip');await writeFile(archive,b,{flag:'wx'});
  const zip=await Zip.load(archive),files=[];
  try {for(const e of zip.entries.filter(e=>!e.name.endsWith('/'))) {
    const output=path.join(stage,e.name);await zip.extract(e,output);
    files.push({name:path.relative(directory,output),sha256:await sha256(output)});
  }}finally{await zip.close();}
  const adb=path.relative(directory,path.join(stage,'platform-tools','adb.exe'));
  if(!files.some(f=>f.name===adb))throw Error('Missing ADB executable');
  await writeFile(receiptPath,JSON.stringify({url:URL,sha1:SHA1,archiveSHA256:createHash('sha256').update(b).digest('hex'),acceptedSdkTerms:true,adb,files},null,2),{flag:'wx'});
  return path.join(directory,adb);
}
