import {open,stat,readFile,mkdir,mkdtemp,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Zip} from './archive.mjs';
import {manifest} from './manifest.mjs';
import {sha256} from '../Common/hash.mjs';
import {verifyApkV2} from './signature.mjs';

export const PACKAGE='com.square_enix.android_googleplay.khuxww';
export const ACTIVITY='org.cocos2dx.cpp.AppActivity';
export const OBB_DIR=`/sdcard/Android/obb/${PACKAGE}`;
export const profilePath=fileURLToPath(new URL('./target-profile.json',import.meta.url));
export async function bgad(file) {
  const f=await open(file,'r');let p=0,records=0;const modes={};
  try {
    const size=(await f.stat()).size;
    while(p<size) {
      const b=Buffer.alloc(24),r=await f.read(b,0,24,p);
      if(r.bytesRead!==24||b.toString('ascii',0,4)!=='BGAD'||b.readUInt16LE(4)!==2)throw Error('Invalid/truncated BGAD v2 record');
      const header=b.readUInt16LE(8),name=b.readUInt16LE(10),data=b.readUInt32LE(16);
      if(header!==24||!name||p+header+name+data>size)throw Error('Invalid BGAD record bounds');
      const key=`${b.readUInt16LE(6)}/${b.readUInt16LE(12)}/${b.readUInt16LE(14)}`;modes[key]=(modes[key]||0)+1;
      p+=header+name+data;records++;
      if(records>1000000)throw Error('BGAD record limit exceeded');
    }
    if(!records)throw Error('Empty BGAD content');return {format:'BGAD',version:2,records,modes};
  }finally{await f.close();}
}
export async function inspectApk(file) {
  if((await stat(file)).size>128*1024*1024)throw Error('APK exceeds prototype size limit');
  const z=await Zip.load(file);
  try {
    const m=manifest(await z.bytes(z.entries.find(e=>e.name==='AndroidManifest.xml')));
    if(m.packageId!==PACKAGE||m.versionName!=='5.0.1'||m.versionCode!==87||m.split||m.debuggable)throw Error('Requires standalone WW 5.0.1 (87), non-debug APK');
    if(!z.entries.some(e=>e.name==='classes.dex'))throw Error('Missing classes.dex');
    const architectures=[];
    for(const e of z.entries.filter(e=>/^lib\/[^/]+\/libcocos2dcpp\.so$/.test(e.name))) {
      const b=await z.bytes(e),abi=e.name.split('/')[1];
      if(b.toString('hex',0,4)!=='7f454c46'||b[5]!==1||!(abi==='arm64-v8a'&&b[4]===2&&b.readUInt16LE(18)===183||abi==='armeabi-v7a'&&b[4]===1&&b.readUInt16LE(18)===40))throw Error('Invalid native architecture');
      architectures.push(abi);
    }
    if(!architectures.includes('arm64-v8a')||!architectures.includes('armeabi-v7a'))throw Error('Expected both ARM native libraries');
    delete m.elements;
    return {...m,architectures:architectures.sort(),bytes:(await stat(file)).size,sha256:await sha256(file),signing:await verifyApkV2(file)};
  }finally{await z.close();}
}
// Every extraction goes into a fresh directory. Originals are read-only inputs.
export async function prepare(inputs,workspace) {
  const profile=JSON.parse(await readFile(profilePath,'utf8'));
  if(profile.apk.sha256.length!==64||profile.content.length!==2)throw Error('Target profile not calibrated');
  await mkdir(workspace,{recursive:true});const stage=await mkdtemp(path.join(path.resolve(workspace),'android-'));
  let apk=null;const candidates=[];
  for(const file of inputs) {
    const f=await open(file,'r');const head=Buffer.alloc(4);try{await f.read(head,0,4,0);}finally{await f.close();}
    if(head.toString('ascii')==='BGAD'){candidates.push(path.resolve(file));continue;}
    const zip=await Zip.load(file);
    try {
      if(zip.entries.some(e=>e.name==='AndroidManifest.xml')) {
        if(apk)throw Error('More than one APK supplied');apk=path.resolve(file);
      } else {
        const apks=zip.entries.filter(e=>e.name.endsWith('.apk'));
        const obbs=zip.entries.filter(e=>e.name.endsWith('.obb'));
        if(apks.length!==1||obbs.length!==2||apk)throw Error('Requires one standalone APK and exactly two OBBs; split/ambiguous archives unsupported');
        for(const [i,e] of [...apks,...obbs].entries()) {
          if(e.bytes>2*1024**3||!e.bytes)throw Error('Invalid input size');
          const target=path.join(stage,`input-${i}`);await zip.extract(e,target);
          if(i===0)apk=target;else candidates.push(target);
        }
      }
    }finally{await zip.close();}
  }
  if(!apk||candidates.length!==2)throw Error('Supply one APK plus main and patch OBBs, or one complete XAPK');
  const packageInfo=await inspectApk(apk);
  if(packageInfo.sha256!==profile.apk.sha256||packageInfo.bytes!==profile.apk.bytes)throw Error('APK differs from locally inspected baseline; do not install an unreviewed/repacked APK');
  // Android's install frontend requires an .apk suffix even though identity
  // validation must not depend on the user-supplied filename.
  const installApk=path.join(stage,'game.apk');await copyFile(apk,installApk);apk=installApk;
  const content=[];
  for(const file of candidates) {
    const digest=await sha256(file),bytes=(await stat(file)).size,expected=profile.content.find(e=>e.sha256===digest&&e.bytes===bytes);
    if(!expected||content.some(e=>e.name===expected.name))throw Error('Unknown, corrupt or duplicate OBB content');
    const structure=await bgad(file);
    content.push({file,name:expected.name,bytes,sha256:digest,structure,destination:`${OBB_DIR}/${expected.name}`});
  }
  return {stage,apk,packageInfo,content,offlinePreparation:'Unmodified APK and BGAD OBBs. Offline gameplay requires real-device verification.',releaseEligible:false};
}
