'use strict';
// Bridge names are retained solely to satisfy the upstream bundle contract.
const logs=[];
// Compatibility flag prevents the bundle from also starting the old native iOS importer.
globalThis.__pwaContent={ready:false,count:0,source:'android-r2'};
globalThis.safariLog=line=>{
  const message=String(line);logs.push(message);if(logs.length>120)logs.shift();
  console.log('[ReAwaken]',message);
};
globalThis.__createStandaloneWorker=()=>{
  const worker=new Worker(new URL('runtime-worker.js',document.baseURI));
  worker.addEventListener('message',({data})=>{
    if(data.type==='error')safariLog('FAIL: '+data.error);
    else if(data.type==='log')safariLog(data.line);
    else if(data.type==='ready'){safariLog('PASS: first runtime render loop');document.body.classList.add('playing');}
  });
  worker.addEventListener('error',event=>safariLog('Worker: '+event.message));return worker;
};
globalThis.__remoteContentReady=fetch('./content-manifest.json').then(r=>{if(!r.ok)throw Error('Content manifest unavailable');return r.json();}).then(manifest=>{
  safariLog(`Android Content: ${manifest.files.length} remote files; ${manifest.version}`);
  globalThis.__pwaContent={ready:true,count:manifest.files.length,source:'android-r2',version:manifest.version};
  return manifest.files.map(file=>({remoteAsset:true,name:file.path.split('/').pop(),webkitRelativePath:file.path,size:file.size,version:manifest.version,blockSize:manifest.blockSize}));
});
__remoteContentReady.catch(error=>safariLog(error.message));
addEventListener('error',event=>safariLog('Page: '+event.message));
addEventListener('unhandledrejection',event=>safariLog('Error: '+(event.reason?.message||event.reason)));
globalThis.crossroadShowDiagnostics=()=>{
  document.dispatchEvent(new Event('crossroad-overlay'));
  let dialog=document.querySelector('#android-diagnostics');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='android-diagnostics';const close=document.createElement('button');close.textContent='Close diagnostics';close.onclick=()=>dialog.close();dialog.append(close,document.createElement('pre'));document.body.append(dialog);}
  dialog.querySelector('pre').textContent='Re:Awaken Android 0.1-poc\n'+navigator.userAgent+'\nVisibility: '+document.visibilityState+'\nAudio: '+JSON.stringify(globalThis.crossroadAudioDiagnostics?.()||{})+'\n'+logs.join('\n');
  if(!dialog.open)dialog.showModal();
};
