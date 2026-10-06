import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {prepare} from './validate.mjs';
import {Adb} from './adb.mjs';
import {obtainAdb} from './tools.mjs';
import {install,preflight} from './install.mjs';
import {loadCompanionReceipt} from './companion.mjs';
import {BetaDiagnostics} from './diagnostics.mjs';

const args=process.argv.slice(2),command=args.shift();
const value=key=>args[args.indexOf(key)+1];
const has=key=>args.includes(key);
const workspace=path.resolve(has('--work')?value('--work'):'runtime-cache/reawaken-android');
const diagnostics=new BetaDiagnostics();let diagnosticAdb;
async function main() {
  const adbPath=has('--adb')?value('--adb'):await obtainAdb(path.join(workspace,'tools'),{acceptSdkTerms:has('--accept-sdk-terms')});
  const adb=diagnostics.attach(new Adb(adbPath,{serial:has('--serial')?value('--serial'):null,keyDirectory:path.join(workspace,'adb-keys')}));diagnosticAdb=adb;
  if(command==='devices'){console.log(JSON.stringify(await adb.devices(),null,2));return;}
  throw Error('Unexpected device command');
}
try {
  if(command==='devices')await main();
  else if(['validate','plan','install'].includes(command)) {
    const inputs=args.flatMap((x,i)=>x==='--input'?[args[i+1]]:[]);
    if(!inputs.length||inputs.some(x=>!x))throw Error('Select user-owned files with --input PATH (repeat for APK/main/patch)');
    const prepared=await prepare(inputs,workspace);
    diagnostics.validated();
    if(command==='validate'){console.log(JSON.stringify(prepared,null,2));}
    else {
      const adbPath=has('--adb')?value('--adb'):await obtainAdb(path.join(workspace,'tools'),{acceptSdkTerms:has('--accept-sdk-terms')});
      const testAvd=has('--nonroot-emulator-test')?'ReAwaken_NonRoot_Install_Test':has('--emulator-test')?'ReAwaken_KHUX_501_WW_Test':null;
      const adb=diagnostics.attach(new Adb(adbPath,{serial:has('--serial')?value('--serial'):null,keyDirectory:path.join(workspace,'adb-keys'),allowEmulator:!!testAvd,expectedAvd:testAvd}));diagnosticAdb=adb;
      if(!adb.serial){const devices=(await adb.devices()).filter(d=>d.usb&&d.state==='device');if(devices.length!==1)throw Error('Connect and authorize one Android USB device, or select its serial explicitly');adb.serial=devices[0].serial;}
      const companionArtifact=has('--companion-receipt')?await loadCompanionReceipt(path.resolve(value('--companion-receipt'))):null;
      if(command==='plan')console.log(JSON.stringify({prepared,preflight:await preflight(adb,prepared,{companionArtifact})},null,2));
      else {
        if(!has('--execute'))throw Error('Validated. Installation requires --execute and --serial DEVICE.');
        const result=await install(adb,prepared,{launch:has('--launch'),companionArtifact,onProgress:e=>{diagnostics.progress(e);console.error(JSON.stringify(e));}});
        diagnostics.complete(result);console.log(JSON.stringify(result,null,2));
      }
    }
  } else throw Error('Usage: node ReAwaken/Android/cli.mjs devices | validate | plan | install --input FILE --work DIRECTORY [--adb PATH | --accept-sdk-terms] [--serial USB_DEVICE] [--execute] [--launch]');
}catch(e){diagnostics.fail(e);console.error(e.message);process.exitCode=1;}
finally{await mkdir(workspace,{recursive:true});await diagnostics.finish(diagnosticAdb);await diagnostics.write(path.join(workspace,'beta-report.json'));}
