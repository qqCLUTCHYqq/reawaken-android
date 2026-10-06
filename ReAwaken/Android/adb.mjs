import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
export class Adb {
  constructor(executable,{serial=null,keyDirectory,runner=null,allowEmulator=false,expectedAvd=null}={}) {this.executable=executable;this.serial=serial;this.keys=keyDirectory;this.runner=runner;this.allowEmulator=allowEmulator;this.expectedAvd=expectedAvd;}
  async run(args,{device=true,timeout=30000}={}) {
    if(device&&!this.serial)throw Error('Select an authorized USB device first');
    const argv=['-P','5038',...(device?['-s',this.serial]:[]),...args];
    if(this.runner)return this.runner(argv);
    if(!this.keys)throw Error('Provide a prototype-only ADB key directory');
    await mkdir(this.keys,{recursive:true});
    return new Promise((resolve,reject)=>{
      // Separate server port. ADB_VENDOR_KEYS adds local keys; Windows ADB still
      // requires its standard .android key directory via the Windows profile API.
      const proc=spawn(this.executable,argv,{shell:false,windowsHide:true,env:{...process.env,ANDROID_USER_HOME:path.resolve(this.keys),ADB_VENDOR_KEYS:path.resolve(this.keys)}});
      let out='',err='';const timer=setTimeout(()=>{proc.kill();reject(Error('ADB timed out; check cable, authorization and device screen'));},timeout);
      proc.stdout.on('data',b=>{out+=b;if(out.length>4*1024*1024)proc.kill();});proc.stderr.on('data',b=>{err+=b;});
      proc.on('error',e=>{clearTimeout(timer);reject(Error(`ADB unavailable: ${e.message}`));});
      proc.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error(`ADB failed: ${err||out}`));else resolve(out.trim());});
    });
  }
  async devices(){return parseDevices(await this.run(['devices','-l'],{device:false}));}
  async select(serial) {
    const devices=await this.devices(),selected=devices.find(d=>d.serial===serial);
    const emulator=this.allowEmulator&&/^emulator-\d+$/.test(serial);
    if(!selected||selected.state!=='device'||!selected.usb&&!emulator)throw Error('Select an authorized USB device (unlock it and accept the computer prompt)');
    this.serial=serial;
    if(emulator) {
      if(!this.expectedAvd||await this.run(['shell','getprop','ro.kernel.qemu'])!=='1')throw Error('Unverified emulator test target');
      const name=await this.run(['shell','getprop','ro.kernel.qemu.avd_name']);
      if(name!==this.expectedAvd)throw Error('Emulator AVD does not match the isolated test device');
    }
    return selected;
  }
  async properties() {
    const get=name=>this.run(['shell','getprop',name]);
    const [sdk,abis,model,release]=await Promise.all(['ro.build.version.sdk','ro.product.cpu.abilist','ro.product.model','ro.build.version.release'].map(get));
    return {sdk:Number(sdk),abis:abis.split(',').filter(Boolean),model,release};
  }
}
export function parseDevices(text) {
  return text.split(/\r?\n/).filter(l=>l.trim()&&!l.startsWith('List of devices')&&!l.startsWith('*')).map(line=>{
    const [serial,state,...details]=line.trim().split(/\s+/);
    return {serial,state,usb:details.some(d=>d.startsWith('usb:')),details:details.join(' '),guidance:state==='unauthorized'?'Unlock device and accept Allow USB debugging':state==='offline'?'Reconnect the cable and recheck USB debugging':state==='device'?'Ready':'Check USB drivers and permissions'};
  });
}
