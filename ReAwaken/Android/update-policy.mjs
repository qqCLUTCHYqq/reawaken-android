// Android desktop files only. Never accept user state, game bytes, saves or iOS paths.
export const REPOSITORY='qqCLUTCHYqq/reawaken-android';
export const MANAGED_FILES=[
 'ReAwaken-Android-Beta.exe','Common/hash.mjs','READ-ME-FIRST.txt',
 ...['adb.mjs','archive.mjs','beta-version.mjs','cli.mjs','companion.mjs','diagnostics.mjs','install.mjs','manifest.mjs','signature.mjs','target-profile.json','tools.mjs','validate.mjs','DesktopLauncher.cs','update-policy.mjs','updater.mjs','app-version.json','companion/AndroidManifest.xml','companion/MainActivity.java','companion/artifact.json','companion/reawaken-content-installer.apk','runtime/node.exe','runtime/LICENSE','runtime/provenance.json'].map(x=>'Android/'+x)
];
export function parseVersion(s){
 const m=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(beta|rc)\.(0|[1-9]\d*))?$/.exec(s);
 if(!m)throw Error('Unsupported Android version');return [Number(m[1]),Number(m[2]),Number(m[3]),m[4]?m[4]==='beta'?0:1:2,Number(m[5]||0)];
}
export function compareVersions(a,b){const x=parseVersion(a),y=parseVersion(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
export function selectRelease(releases,installed,channel){
 if(!['Beta','Stable'].includes(channel))throw Error('Invalid Android update channel');parseVersion(installed);
 const candidates=[];
 for(const r of releases){
  if(r.draft||(!r.prerelease&&channel==='Beta')||(r.prerelease&&channel==='Stable'))continue;
  const version=String(r.tag_name).replace(/^reawaken-android-v/,'');
  if(r.tag_name!=='reawaken-android-v'+version)continue;
  try{if(compareVersions(version,installed)<=0||Boolean(parseVersion(version)[3]<2)!==Boolean(r.prerelease))continue;}catch{continue;}
  const assets=(r.assets||[]).filter(a=>/^ReAwaken-Android-[A-Za-z0-9.-]+-Windows-x64\.zip$/.test(a.name)&&a.state==='uploaded');
  if(assets.length!==1)continue;const asset=assets[0];
  const expected=`https://github.com/${REPOSITORY}/releases/download/${r.tag_name}/${asset.name}`;
  if(asset.browser_download_url!==expected||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))continue;
  if(!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>256*1024*1024)continue;
  candidates.push({version,name:r.name||version,notes:String(r.body||'').slice(0,64000),url:expected,sha256:asset.digest.slice(7),bytes:asset.size});
 }
 return candidates.sort((a,b)=>compareVersions(b.version,a.version))[0]||null;
}
