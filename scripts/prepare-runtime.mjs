// Fetch a pinned upstream-derived artifact set. Never modify the iOS repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock=JSON.parse(await fs.readFile(path.join(root,'runtime-lock.json'),'utf8'));
const output=path.join(root,'app/build/generated/runtime-assets/web');
await fs.mkdir(output,{recursive:true});
const index=process.argv.indexOf('--source');
const local=index>=0?process.argv[index+1]:null;
for(const [name,sha] of Object.entries(lock.files)) {
  const bytes=local?await fs.readFile(path.join(local,name)):await (async()=>{
    const response=await fetch(`https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/CrossRoad/Web/${name}`);
    if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  })();
  if(createHash('sha256').update(bytes).digest('hex')!==sha)throw Error(`Upstream SHA-256 mismatch: ${name}`);
  let result=bytes;
  if(name==='runtime-worker.js') {
    // Android ANGLE reports the same precision mismatch differently from Firefox.
    // Reuse the existing retry/normalizer only after this specific link failure.
    const before='/not linkable between attached shaders/.test(t)';
    const after='/not linkable between attached shaders|Uniforms with the same name but different type\\/precision/.test(t)';
    const text=bytes.toString();
    if(text.split(before).length!==2)throw Error('Shader precision retry changed upstream');
    result=Buffer.from(text.replace(before,after));
  }
  if(name==='app.js') {
    let text=bytes.toString();
    for(const [from,to] of [['"./audio-lifecycle.js"','"./android-audio.js"'],['"./mobile-runtime.js"','"./android-runtime.js"']]) {
      if(text.split(from).length!==2)throw Error('Platform import changed upstream');
      text=text.replace(from,to);
    }
    result=Buffer.from(text);
  }
  if(name==='game.html') {
    let text=bytes.toString();
    text=text.replace(/\s*<link[^>]*(?:manifest\.webmanifest|apple-touch-icon|pwa\.css)[^>]*>/g,'')
      .replace(/\s*<meta[^>]*name="apple-[^>]*>/g,'')
      .replace(/<script>\s*if \('serviceWorker'[\s\S]*?<\/script>/,'')
      .replace('src="pwa-loader.js"','src="android-loader.js"')
      .replace('<title>Cross Road — Safari test</title>','<title>Re:Awaken Android</title>')
      .replace('</head>','<link rel="stylesheet" href="android.css"></head>');
    if(text.includes('service-worker.js')||text.includes('pwa-loader.js'))throw Error('Unexpected PWA bootstrap');
    result=Buffer.from(text);
  }
  // Android asset packaging treats .gz specially. Keep the original compressed
  // bytes under a neutral suffix; MainActivity serves the original runtime URL.
  const packagedName=name.endsWith('.gz')?name+'.payload':name;
  await fs.writeFile(path.join(output,packagedName),result);
  if(packagedName!==name)await fs.rm(path.join(output,name),{force:true});
}
for(const name of await fs.readdir(path.join(root,'web')))await fs.copyFile(path.join(root,'web',name),path.join(output,name));
console.log(`Prepared pinned runtime ${lock.commit}; Android platform adapters only.`);
