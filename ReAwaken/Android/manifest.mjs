// Read Android's binary XML, never trust the XAPK manifest or input filename.
export function manifest(bytes) {
  if(bytes.length<8||bytes.readUInt16LE(0)!==3||bytes.readUInt32LE(4)!==bytes.length)throw Error('Invalid binary AndroidManifest.xml');
  let strings=[],elements=[];
  for(let p=bytes.readUInt16LE(2);p<bytes.length;) {
    if(p+8>bytes.length)throw Error('Truncated XML chunk');
    const type=bytes.readUInt16LE(p),header=bytes.readUInt16LE(p+2),size=bytes.readUInt32LE(p+4);
    if(header<8||size<header||p+size>bytes.length)throw Error('Invalid XML chunk bounds');
    const b=bytes.subarray(p,p+size);
    if(type===1) {
      const count=b.readUInt32LE(8),flags=b.readUInt32LE(16),base=b.readUInt32LE(20);
      if(header<28||header+count*4>size)throw Error('Invalid string pool');
      strings=Array.from({length:count},(_,i)=>{
        let q=base+b.readUInt32LE(header+i*4);
        const len8=()=>{let n=b[q++];if(n&128)n=((n&127)<<8)|b[q++];return n;};
        const len16=()=>{let n=b.readUInt16LE(q);q+=2;if(n&32768){n=((n&32767)*65536)+b.readUInt16LE(q);q+=2;}return n;};
        if(flags&256){len8();const n=len8();if(q+n>=size||b[q+n]!==0)throw Error('Invalid UTF8 string');return b.subarray(q,q+n).toString('utf8');}
        const n=len16()*2;if(q+n+2>size||b.readUInt16LE(q+n)!==0)throw Error('Invalid UTF16 string');return b.subarray(q,q+n).toString('utf16le');
      });
    } else if(type===0x102) {
      if(header!==16||size<36)throw Error('Invalid XML element');
      const name=strings[b.readUInt32LE(20)],start=16+b.readUInt16LE(24),stride=b.readUInt16LE(26),count=b.readUInt16LE(28),attrs={};
      if(stride!==20||start+count*stride>size)throw Error('Invalid XML attributes');
      for(let i=0;i<count;i++) {
        const a=start+i*stride,ns=b.readUInt32LE(a),key=strings[b.readUInt32LE(a+4)],raw=b.readUInt32LE(a+8),kind=b[a+15],data=b.readUInt32LE(a+16);
        const prefix=ns===0xffffffff?'':strings[ns]==='http://schemas.android.com/apk/res/android'?'android:':'other:';
        if(Object.hasOwn(attrs,prefix+key))throw Error('Duplicate XML attribute');
        attrs[prefix+key]=raw!==0xffffffff?strings[raw]:kind===3?strings[data]:kind===0x12?Boolean(data):data;
      }
      elements.push({name,attrs});
    }
    p+=size;
  }
  const root=elements.find(e=>e.name==='manifest')?.attrs,sdk=elements.find(e=>e.name==='uses-sdk')?.attrs;
  if(!root||!sdk)throw Error('Missing manifest/uses-sdk');
  return {packageId:root.package,versionName:root['android:versionName'],versionCode:Number(root['android:versionCode']),split:root.split||null,minSdk:Number(sdk['android:minSdkVersion']),targetSdk:Number(sdk['android:targetSdkVersion']),debuggable:elements.find(e=>e.name==='application')?.attrs['android:debuggable']===true,elements};
}
