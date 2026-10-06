import os from 'node:os';
import {writeFile} from 'node:fs/promises';
import {BETA_VERSION,BETA_NAME,FEEDBACK_URL} from './beta-version.mjs';
const PACKAGE='com.square_enix.android_googleplay.khuxww';
// Export fixed classifications, never arbitrary ADB/logcat text. Free-form logs
// can contain credentials, account names, paths, save state and device serials.
export function errorCodes(text){
  const value=String(text),codes=new Set();
  for(const [pattern,code] of [
    [/permission denied|access.*denied|denied.*access/i,'ACCESS_DENIED'],
    [/unauthorized|authorize|authorization|computer prompt/i,'ADB_AUTHORIZATION_REQUIRED'],
    [/offline|no devices|device.*not found|one Android USB|Select an authorized/i,'ADB_DEVICE_UNAVAILABLE'],
    [/timed out|timeout/i,'TIMEOUT'],[/already installed|existing.*(content|directory|data)|differs.*replacement/i,'EXISTING_INSTALLATION_PRESERVED'],
    [/hash mismatch|integrity (?:check|verification|failure)|checksum|baseline mismatch|digest mismatch/i,'INTEGRITY_CHECK_FAILED'],
    [/incompatible|no matching abis/i,'DEVICE_ABI_OR_API_INCOMPATIBLE'],
    [/free space|no space left|insufficient/i,'INSUFFICIENT_STORAGE'],
    [/blocked|blocks normal|storage access|OBB directory denied|installer access.*denied/i,'OBB_ACCESS_BLOCKED'],
    [/INSTALL_FAILED_OLDER_SDK/,'INSTALL_FAILED_OLDER_SDK'],[/INSTALL_FAILED_NO_MATCHING_ABIS/,'INSTALL_FAILED_NO_MATCHING_ABIS'],
    [/INSTALL_FAILED_INSUFFICIENT_STORAGE/,'INSTALL_FAILED_INSUFFICIENT_STORAGE'],[/INSTALL_FAILED_USER_RESTRICTED/,'INSTALL_FAILED_USER_RESTRICTED'],
    [/INSTALL_FAILED_UPDATE_INCOMPATIBLE/,'INSTALL_FAILED_UPDATE_INCOMPATIBLE'],[/INSTALL_FAILED_ALREADY_EXISTS/,'INSTALL_FAILED_ALREADY_EXISTS'],
    [/INSTALL_FAILED_DEPRECATED_SDK_VERSION/,'INSTALL_FAILED_DEPRECATED_SDK_VERSION'],
    [/SecurityException/,'JAVA_SECURITY_EXCEPTION'],[/UnsatisfiedLinkError/,'NATIVE_LIBRARY_LOAD_FAILED'],
    [/FileNotFoundException/,'FILE_NOT_FOUND'],[/OutOfMemoryError/,'OUT_OF_MEMORY'],
    [/NullPointerException/,'JAVA_NULL_POINTER'],[/FATAL EXCEPTION/,'JAVA_FATAL_EXCEPTION'],
    [/SIGSEGV/,'NATIVE_SIGSEGV'],[/SIGABRT/,'NATIVE_SIGABRT'],[/Launch failed|Activity.*not.*found/i,'LAUNCH_FAILED']
  ])if(pattern.test(value))codes.add(code);
  return [...codes];
}
export function packageCrashCodes(log){
  let remaining=0;const selected=[];
  for(const line of String(log).split(/\r?\n/)){
    if(/Process:|Cmdline:/.test(line))remaining=line.includes(PACKAGE)?40:0;
    if(remaining-->0)selected.push(line);
  }
  return errorCodes(selected.join('\n'));
}
export function appLogErrorCodes(log){return errorCodes(String(log).split(/\r?\n/).filter(l=>/^[EF]\//.test(l)||/^\s+(?:at |Caused by:)/.test(l)).join('\n'));}
const field=value=>String(value??'UNKNOWN').replace(/[^\p{L}\p{N} ._+-]/gu,'').slice(0,64)||'UNKNOWN';
const stageKeys=['validation','apkInstall','obbPlacement','obbHashVerification','launch'];
export class BetaDiagnostics {
  constructor(){this.report={schemaVersion:1,application:BETA_NAME,version:BETA_VERSION,windows:{platform:process.platform,version:field(os.release())},android:{manufacturer:'UNKNOWN',model:'UNKNOWN',version:'UNKNOWN',apiLevel:null,abis:[]},adbConnection:'NOT_CHECKED',package:{id:PACKAGE,present:'UNKNOWN',versionName:null,versionCode:null},results:Object.fromEntries(stageKeys.map(k=>[k,'NOT_RUN'])),contentRoute:'NOT_SELECTED',outcome:'NOT_RUN',errors:[],logcat:{status:'NOT_COLLECTED',errorCodes:[]},feedbackUrl:FEEDBACK_URL,privacy:'No serials, account names, file paths, arbitrary logs, game content, saves or credentials. Review before submitting.'};this.phase='validation';}
  record(source,operation,error){const codes=errorCodes(error);this.report.errors.push({source,operation,errorCodes:codes.length?codes:['UNCLASSIFIED_ERROR_REDACTED']});this.report.errors=this.report.errors.slice(-20);}
  attach(adb){const run=adb.run.bind(adb);adb.run=async(args,options)=>{
    try{const out=await run(args,options);
      if(args[0]==='devices'){this.report.adbConnection=/\sdevice\b/.test(out)?'DEVICE_AVAILABLE':/unauthorized/.test(out)?'UNAUTHORIZED':/offline/.test(out)?'OFFLINE':'NO_DEVICE';}
      if(args.join(' ')==='shell id')this.report.adbConnection=/^uid=2000\(shell\)/.test(out)?'AUTHORIZED_NON_ROOT':'ROOT_SESSION_REFUSED';
      if(args[0]==='install'&&args.at(-1)?.endsWith('game.apk'))this.report.results.apkInstall=/^Success\s*$/m.test(out)?'PASS':'FAIL';
      if(args.join(' ')==='shell pm list packages '+PACKAGE)this.report.package.present=out.split(/\r?\n/).includes('package:'+PACKAGE)?'YES':'NO';
      if(args.join(' ')==='shell dumpsys package '+PACKAGE){const n=/versionName=([0-9.]+)/.exec(out),c=/versionCode=(\d+)/.exec(out);this.report.package.versionName=n?.[1]??null;this.report.package.versionCode=c?Number(c[1]):null;}
      return out;
    }catch(e){const operation=args[0]==='install'?'APK_INSTALL':args[0]==='push'?'CONTENT_TRANSFER':args[0]==='devices'?'DEVICE_DETECTION':args[1]==='am'?'ACTIVITY':args[1]==='getprop'?'DEVICE_PROPERTIES':'DEVICE_COMMAND';this.record('ADB',operation,e.message);throw e;}
  };return adb;}
  progress(event){const p=event.phase;
    if(p==='installing-apk')this.phase='apkInstall';
    if(['placing-content','transferring'].includes(p))this.phase='obbPlacement';
    if(p==='verified'||p==='content-verification'){this.phase='obbHashVerification';this.report.results.obbPlacement='PASS';}
    if(p==='content-verified'){this.report.results.obbPlacement='PASS';this.report.results.obbHashVerification='PASS';}
    if(p==='launching-game')this.phase='launch';
  }
  validated(){this.report.results.validation='PASS';this.phase='preflight';}
  complete(result){this.report.outcome='PASS';this.report.contentRoute=['adb','installer-companion'].includes(result.route)?result.route:'UNKNOWN';if(result.contentVerified){this.report.results.obbPlacement='PASS';this.report.results.obbHashVerification='PASS';}this.report.results.launch=result.launched?'PASS':'NOT_RUN';}
  fail(error){this.report.outcome='FAIL';if(stageKeys.includes(this.phase))this.report.results[this.phase]='FAIL';this.record('INSTALLER',this.phase.toUpperCase(),error.message);}
  async finish(adb){
    if(!adb?.serial)return;
    try{await adb.select(adb.serial);if(!/^uid=2000\(shell\)/.test(await adb.run(['shell','id'])))return;
      const values=await Promise.all(['ro.product.manufacturer','ro.product.model','ro.build.version.release','ro.build.version.sdk','ro.product.cpu.abilist'].map(p=>adb.run(['shell','getprop',p])));
      this.report.android={manufacturer:field(values[0]),model:field(values[1]),version:field(values[2]),apiLevel:/^\d+$/.test(values[3])?Number(values[3]):null,abis:values[4].split(',').filter(a=>['arm64-v8a','armeabi-v7a','armeabi','x86','x86_64','riscv64'].includes(a))};
      await adb.run(['shell','pm','list','packages',PACKAGE]);if(this.report.package.present==='YES')await adb.run(['shell','dumpsys','package',PACKAGE]);
      const pids=await adb.run(['shell','pidof',PACKAGE]).catch(()=> '');
      if(!/^\d+( \d+)*$/.test(pids)){const crash=await adb.run(['logcat','-d','-b','crash','-t','200','-v','brief']);this.report.logcat={status:'RECENT_PACKAGE_CRASH_CODES_ONLY',errorCodes:packageCrashCodes(crash)};return;}
      // Restrict to the game's current PID, then retain fixed error codes only.
      const log=await adb.run(['logcat','-d','--pid='+pids.split(' ')[0],'-t','200','-v','brief']);
      this.report.logcat={status:'COLLECTED_SANITIZED',errorCodes:appLogErrorCodes(log)};
    }catch{this.report.logcat.status='COLLECTION_UNAVAILABLE';}
  }
  async write(file){await writeFile(file,JSON.stringify(this.report,null,2)+'\n');}
}
