import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Zip,crc32} from './archive.mjs';
import {manifest} from './manifest.mjs';
import {Adb,parseDevices} from './adb.mjs';
import {bgad} from './validate.mjs';
import {install,PROBE_SHA256} from './install.mjs';
import {verifyApkV2} from './signature.mjs';

function zipFixture(name,payload) {
  const n=Buffer.from(name),crc=(crc32(payload)^0xffffffff)>>>0;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt32LE(crc,14);local.writeUInt32LE(payload.length,18);local.writeUInt32LE(payload.length,22);local.writeUInt16LE(n.length,26);
  const dir=Buffer.alloc(46);dir.writeUInt32LE(0x02014b50);dir.writeUInt32LE(crc,16);dir.writeUInt32LE(payload.length,20);dir.writeUInt32LE(payload.length,24);dir.writeUInt16LE(n.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(dir.length+n.length,12);end.writeUInt32LE(local.length+n.length+payload.length,16);
  return Buffer.concat([local,n,payload,dir,n,end]);
}
test('ZIP validates content CRC; truncated and traversal inputs fail',async()=>{
  const d=await mkdtemp(path.join(os.tmpdir(),'reawaken-test-')),file=path.join(d,'input');
  const bytes=zipFixture('assets/test',Buffer.from('abc'));await writeFile(file,bytes);
  const z=await Zip.load(file);assert.equal((await z.bytes(z.entries[0])).toString(),'abc');await z.close();
  bytes[30+'assets/test'.length]^=1;await writeFile(file,bytes);const corrupt=await Zip.load(file);
  await assert.rejects(corrupt.bytes(corrupt.entries[0]),/CRC/);await corrupt.close();
  await writeFile(file,bytes.subarray(0,bytes.length-1));await assert.rejects(Zip.load(file),/complete/);
  await writeFile(file,zipFixture('../escape',Buffer.from('abc')));await assert.rejects(Zip.load(file),/Unsafe/);
});
test('Malformed Android binary manifest fails closed',()=>{
  assert.throws(()=>manifest(Buffer.from('filename says 5.0.1')),/Invalid/);
  const b=Buffer.alloc(16);b.writeUInt16LE(3);b.writeUInt16LE(8,2);b.writeUInt32LE(16,4);b.writeUInt16LE(1,8);b.writeUInt16LE(8,10);b.writeUInt32LE(0,12);
  assert.throws(()=>manifest(b),/bounds/);
});
test('BGAD v2 flags do not change version; truncation fails',async()=>{
  const d=await mkdtemp(path.join(os.tmpdir(),'reawaken-bgad-')),file=path.join(d,'content');
  const b=Buffer.alloc(34);b.write('BGAD');b.writeUInt16LE(2,4);b.writeUInt16LE(4,6);b.writeUInt16LE(24,8);b.writeUInt16LE(2,10);b.writeUInt16LE(3,12);b.writeUInt32LE(8,16);
  await writeFile(file,b);assert.equal((await bgad(file)).records,1);
  await writeFile(file,b.subarray(0,33));await assert.rejects(bgad(file),/bounds/);
});
test('ADB states, USB selection and serial-scoped commands',async()=>{
  const output='List of devices attached\nready device usb:1-2 model:Thor\nlocked unauthorized usb:1-3\nstale offline usb:1-4\nemulator-5554 device product:sdk\n';
  assert.deepEqual(parseDevices(output).map(d=>d.state),['device','unauthorized','offline','device']);
  const calls=[],adb=new Adb('adb',{runner:async a=>{calls.push(a);return a.includes('devices')?output:'34';}});
  await assert.rejects(adb.select('locked'),/authorized/);await assert.rejects(adb.select('emulator-5554'),/USB/);
  await adb.select('ready');await adb.run(['shell','getprop','ro.build.version.sdk']);
  assert.deepEqual(calls.at(-1),['-P','5038','-s','ready','shell','getprop','ro.build.version.sdk']);
});
test('Invalid installation plan never executes an APK install',async()=>{
  const calls=[],adb=new Adb('adb',{serial:'ready',runner:async a=>{calls.push(a);return 'List of devices attached\nready device usb:1-2';}});
  await assert.rejects(install(adb,{apk:'nonexistent-user-input',content:[]}));assert(!calls.some(a=>a.includes('install')));
});
test('User installation refuses a root ADB session before any install or file transfer',async()=>{
  const calls=[],adb=new Adb('adb',{serial:'ready',runner:async a=>{calls.push(a);return a.includes('devices')?'List of devices attached\nready device usb:1-2':'uid=0(root) gid=0(root)';}});
  await assert.rejects(install(adb,{apk:'unused',content:[]}),/non-root/);
  assert(!calls.some(a=>a.includes('install')||a.includes('push')));
});
test('Emulator testing requires explicit opt-in and the exact isolated AVD',async()=>{
  const runner=async a=>a.includes('devices')?'List of devices attached\nemulator-5580 device product:sdk':a.at(-1)==='ro.kernel.qemu.avd_name'?'ReAwaken_KHUX_501_WW_Test':'1';
  const disabled=new Adb('adb',{runner});await assert.rejects(disabled.select('emulator-5580'),/USB/);
  const wrong=new Adb('adb',{runner,allowEmulator:true,expectedAvd:'OTHER'});await assert.rejects(wrong.select('emulator-5580'),/does not match/);
  const enabled=new Adb('adb',{runner,allowEmulator:true,expectedAvd:'ReAwaken_KHUX_501_WW_Test'});assert.equal((await enabled.select('emulator-5580')).state,'device');
});

// Optional integration exercises the real local files through a simulated USB device.
if(process.env.REAWAKEN_TEST_PLAN) {
  const plan=JSON.parse(await readFile(process.env.REAWAKEN_TEST_PLAN,'utf8'));
  test('Real APK signature passes; changed signed bytes fail',async()=>{
    assert.equal((await verifyApkV2(plan.apk)).contentDigestVerified,true);
    const bytes=await readFile(plan.apk);bytes[50000]^=1;
    const d=await mkdtemp(path.join(os.tmpdir(),'reawaken-signature-')),file=path.join(d,'changed.apk');await writeFile(file,bytes);
    await assert.rejects(verifyApkV2(file),/digest mismatch/);
  });
  for(const scenario of ['success','existing-package','existing-content','storage-blocked','hash-failure'])test(`Local validated inputs: ${scenario}`,async()=>{
    const calls=[],adb=new Adb('adb',{serial:'TEST',runner:async a=>{
      calls.push(a);const args=a.slice(a.includes('-s')?4:2),s=args.join(' ');
      if(args[0]==='devices')return 'List of devices attached\nTEST device usb:1-2 model:Thor';
      if(s==='shell id')return 'uid=2000(shell) gid=2000(shell)';
      if(s==='shell getprop ro.build.version.sdk')return '34';
      if(s==='shell getprop ro.product.cpu.abilist')return 'arm64-v8a';
      if(s==='shell getprop ro.product.model')return 'SIMULATED';
      if(s==='shell getprop ro.build.version.release')return '14';
      if(s==='shell am get-current-user')return '0';
      if(s.startsWith('shell pm list'))return scenario==='existing-package'?`package:${plan.packageInfo.packageId}`:'';
      if(s.startsWith('shell test -w'))return scenario==='storage-blocked'?'BLOCKED':'WRITABLE';
      if(s.startsWith('shell test'))return scenario==='existing-content'?'EXISTS':'ABSENT';
      if(s.startsWith('shell df'))return 'Filesystem 1K-blocks Used Available Use% Mounted\n/data 10000000 1000 9000000 1% /data';
      if(args[0]==='install')return 'Success';
      if(s.startsWith('shell toybox sha256sum')&&args.at(-1).includes('.reawaken-probe-'))return PROBE_SHA256;
      if(s.startsWith('shell toybox sha256sum'))return scenario==='hash-failure'?'0'.repeat(64):plan.content.find(c=>args.at(-1).includes(c.name)).sha256;
      if(s.startsWith('shell pm path'))return 'package:/data/app/TEST/base.apk';
      if(s.startsWith('shell dumpsys'))return 'versionCode=87 minSdk=15 targetSdk=31\nversionName=5.0.1';
      if(s.startsWith('shell am start'))return 'Status: ok';
      return '';
    }});
    if(scenario==='success') {const r=await install(adb,structuredClone(plan),{launch:true});assert(r.contentVerified&&r.launched&&!r.offlineGameplayVerified);}
    else {await assert.rejects(install(adb,structuredClone(plan),{launch:true}),scenario==='hash-failure'?/hash mismatch/:scenario==='storage-blocked'?/blocks normal ADB/:/protect/);assert(!calls.some(a=>a.includes('start')));if(scenario!=='hash-failure')assert(!calls.some(a=>a.includes('install')));}
    assert(!calls.some(a=>a.includes('uninstall')||a.includes('clear')||a.includes('-r')));
  });
}
