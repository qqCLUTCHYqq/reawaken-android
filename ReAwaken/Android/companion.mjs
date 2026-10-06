import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from '../Common/hash.mjs';
export const COMPANION='org.reawaken.android.installer';
const ACTIVITY=`${COMPANION}/.MainActivity`,PORT=38765;

// This session uses only a selected normal ADB device and an owned, pinned companion.
// Content travels via USB reverse to a loopback-only server; there is no LAN listener.
export async function companionSession(adb,prepared,{artifact,installApk,probeOnly=false,onProgress=()=>{}}={}) {
  await adb.select(adb.serial);
  if(!/^uid=2000\(shell\)/.test(await adb.run(['shell','id'])))throw Error('Non-root ADB required');
  if(!artifact?.apk||!artifact?.sha256||await sha256(artifact.apk)!==artifact.sha256)throw Error('Unverified companion artifact');
  const listed=await adb.run(['shell','pm','list','packages',COMPANION]);
  const present=listed.split(/\r?\n/).includes(`package:${COMPANION}`)?await adb.run(['shell','pm','path',COMPANION]):'';
  if(present.startsWith('package:')){
    const p=present.split(/\r?\n/)[0].slice(8);
    if(!/^\/data\/app\/[A-Za-z0-9_~+/=.-]+(?:\/[A-Za-z0-9_~+=.-]+)*\/base\.apk$/.test(p))throw Error('Unexpected companion path');
    if((await adb.run(['shell','toybox','sha256sum',p])).split(/\s+/)[0]!==artifact.sha256)throw Error('Existing companion differs; refusing replacement');
  }else if(!/^Success\s*$/m.test(await adb.run(['install','--no-streaming',artifact.apk],{timeout:300000})))throw Error('Companion install failed');
  const token=randomBytes(32).toString('hex');let installReady=false;
  let signal;const queue=[];let failure;
  const verified=new Set();
  const server=http.createServer(async(req,res)=>{
    try{
      const route=req.url?.slice(`/${token}/`.length);
      if(!req.url?.startsWith(`/${token}/`)){res.writeHead(404).end();return;}
      if(req.method==='POST'&&route==='status'){
        let body='';for await(const b of req){body+=b;if(body.length>16384)throw Error('Oversized status');}
        const status=JSON.parse(body);
        if(!Number.isInteger(status.uid)||status.uid<10000||typeof status.phase!=='string'||typeof status.detail!=='string')throw Error('Invalid companion status');
        queue.push(status);res.writeHead(200).end('{}');signal?.();return;
      }
      if(req.method!=='GET'){res.writeHead(405).end();return;}
      if(route==='next'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({installReady,packageId:prepared.packageInfo.packageId}));return;}
      const match=/^content\/([01])$/.exec(route);
      if(!probeOnly&&installReady&&match){const c=prepared.content[Number(match[1])];res.setHeader('Content-Length',c.bytes);res.setHeader('Content-Type','application/octet-stream');const stream=createReadStream(c.file);stream.on('error',()=>res.destroy());stream.pipe(res);return;}
      res.writeHead(404).end();
    }catch(e){res.writeHead(400).end();failure=e;signal?.();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,'127.0.0.1',resolve);});
  let reversed=false;let timer;
  try{
    const mappings=await adb.run(['reverse','--list']);
    if(mappings.split(/\r?\n/).some(l=>l.split(/\s+/).includes(`tcp:${PORT}`)))throw Error('Companion USB port is already in use');
    await adb.run(['reverse',`tcp:${PORT}`,`tcp:${PORT}`]);reversed=true;
    const start=async provisioned=>{
      await adb.run(['shell','am','force-stop',COMPANION]);
      await adb.run(['shell','am','start','-W','-n',ACTIVITY,'--es','token',token,'--ez','provisioned',String(provisioned),'--ez','probeOnly',String(probeOnly)]);
    };
    await start(false);onProgress({phase:'permissions-needed',detail:'On the Android device, allow content storage and this installer, then tap Continue.'});
    timer=setTimeout(()=>{failure=Error('Companion setup/transfer timed out; partial content preserved');signal?.();},30*60*1000);
    while(true){
      if(failure)throw failure;
      if(!queue.length){await new Promise(r=>{signal=r;});signal=null;continue;}
      const event=queue.shift();onProgress(event);
      if(event.phase==='blocked')throw Error(`Supported installer access was denied: ${event.detail}. No root or file-manager workaround is used.`);
      if(event.phase==='permissions-granted'){await start(true);continue;}
      if(event.phase==='ready'){
        if(probeOnly)return {route:'installer-companion',nonRoot:true,probePassed:true};
        await installApk();installReady=true;continue;
      }
      if(event.phase==='verified'){
        const found=prepared.content.find(c=>event.detail===`${c.name} ${c.sha256}`);
        if(!found)throw Error('Unexpected content verification receipt');verified.add(found.name);
      }
      if(event.phase==='complete'){
        if(verified.size!==2)throw Error('Incomplete content verification receipt');
        return {route:'installer-companion',nonRoot:true,contentVerified:true,verifiedFiles:[...verified]};
      }
    }
  }finally{
    clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));
    if(reversed)await adb.run(['reverse','--remove',`tcp:${PORT}`]).catch(()=>{});
  }
}

export async function loadCompanionReceipt(file){const receipt=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));if(receipt.packageId!==COMPANION)throw Error('Companion package receipt mismatch');receipt.apk=path.resolve(path.dirname(file),receipt.apk);return receipt;}
