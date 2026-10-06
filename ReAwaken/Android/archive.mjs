import {open, mkdir} from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {createInflateRaw, inflateRawSync} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import path from 'node:path';

const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes, crc=0xffffffff) {for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return crc>>>0;}
export class Zip {
  static async load(file) {
    const zip=new Zip();zip.file=file;zip.handle=await open(file,'r');
    try {
      const size=(await zip.handle.stat()).size;
      const tail=await zip.read(Math.max(0,size-65557),Math.min(size,65557));
      let end=-1;
      for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
      if(end<0)throw Error('Not a complete ZIP/APK/XAPK');
      if(tail.readUInt16LE(end+4)||tail.readUInt16LE(end+6)||tail.readUInt16LE(end+8)!==tail.readUInt16LE(end+10))throw Error('Multi-disk ZIP unsupported');
      const count=tail.readUInt16LE(end+10), length=tail.readUInt32LE(end+12), offset=tail.readUInt32LE(end+16);
      zip.directoryOffset=offset;zip.endOffset=size-tail.length+end;
      if(count===65535||offset===0xffffffff||length>32*1024*1024||offset+length>size-tail.length+end)throw Error('ZIP64 or invalid directory unsupported');
      const dir=await zip.read(offset,length);zip.entries=[];const names=new Set();let p=0;
      for(let i=0;i<count;i++) {
        if(p+46>dir.length||dir.readUInt32LE(p)!==0x02014b50)throw Error('Invalid ZIP directory');
        const nl=dir.readUInt16LE(p+28),el=dir.readUInt16LE(p+30),cl=dir.readUInt16LE(p+32);
        if(p+46+nl+el+cl>dir.length)throw Error('Truncated ZIP directory');
        const name=dir.subarray(p+46,p+46+nl).toString('utf8');
        if(!name||name.includes('\\')||name.includes('\0')||name.startsWith('/')||name.includes(':')||name.split('/').some(x=>x==='..'||x==='.'))throw Error('Unsafe archive path');
        if(names.has(name))throw Error('Duplicate archive entry');names.add(name);
        const flags=dir.readUInt16LE(p+8),method=dir.readUInt16LE(p+10),compressed=dir.readUInt32LE(p+20),bytes=dir.readUInt32LE(p+24),local=dir.readUInt32LE(p+42);
        if(flags&1||![0,8].includes(method)||local+30+compressed>offset||[compressed,bytes,local].includes(0xffffffff))throw Error('Unsupported ZIP entry');
        if(method===0&&compressed!==bytes)throw Error('Invalid stored ZIP size');
        zip.entries.push({name,method,compressed,bytes,local,crc:dir.readUInt32LE(p+16)});p+=46+nl+el+cl;
      }
      if(p!==dir.length)throw Error('Unexpected ZIP directory bytes');
      return zip;
    } catch(e){await zip.close();throw e;}
  }
  async read(offset,size){const b=Buffer.alloc(size);const r=await this.handle.read(b,0,size,offset);if(r.bytesRead!==size)throw Error('Truncated archive');return b;}
  async dataOffset(e) {
    const b=await this.read(e.local,30);
    if(b.readUInt32LE(0)!==0x04034b50||b.readUInt16LE(8)!==e.method)throw Error('Invalid local ZIP header');
    const n=b.readUInt16LE(26),extra=b.readUInt16LE(28);
    if((await this.read(e.local+30,n)).toString('utf8')!==e.name)throw Error('ZIP local filename mismatch');
    return e.local+30+n+extra;
  }
  async bytes(e,limit=64*1024*1024) {
    if(!e||e.bytes>limit||e.compressed>limit)throw Error('Missing/oversized entry');
    const b=await this.read(await this.dataOffset(e),e.compressed);
    const out=e.method===8?inflateRawSync(b,{maxOutputLength:limit}):b;
    if(out.length!==e.bytes||((crc32(out)^0xffffffff)>>>0)!==e.crc)throw Error('ZIP size/CRC mismatch');return out;
  }
  async extract(e,file) {
    await mkdir(path.dirname(file),{recursive:true});const start=await this.dataOffset(e);let length=0,crc=0xffffffff;
    const check=new Transform({transform(b,enc,cb){length+=b.length;crc=crc32(b,crc);if(length>e.bytes)cb(Error('ZIP expansion exceeded declared size'));else cb(null,b);}});
    const input=createReadStream(this.file,{start,end:start+e.compressed-1});
    await pipeline(input,...(e.method===8?[createInflateRaw()]:[]),check,createWriteStream(file,{flags:'wx'}));
    if(length!==e.bytes||((crc^0xffffffff)>>>0)!==e.crc)throw Error('ZIP size/CRC mismatch');
  }
  async close(){await this.handle.close();}
}
