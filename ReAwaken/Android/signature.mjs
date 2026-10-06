import {readFile} from 'node:fs/promises';
import {createHash,createPublicKey,verify,X509Certificate,constants} from 'node:crypto';
import {Zip} from './archive.mjs';
const hash=b=>createHash('sha256').update(b).digest();
function fields(b){const result=[];for(let p=0;p<b.length;){if(p+4>b.length)throw Error('Truncated signing field');const n=b.readUInt32LE(p);p+=4;if(p+n>b.length)throw Error('Invalid signing field size');result.push(b.subarray(p,p+n));p+=n;}return result;}
function digest(sections) {
  const chunks=[];
  for(const section of sections)for(let p=0;p<section.length;p+=1024*1024){const b=section.subarray(p,p+1024*1024),header=Buffer.alloc(5);header[0]=0xa5;header.writeUInt32LE(b.length,1);chunks.push(hash(Buffer.concat([header,b])));}
  const header=Buffer.alloc(5);header[0]=0x5a;header.writeUInt32LE(chunks.length,1);return hash(Buffer.concat([header,...chunks]));
}
// Strict single-signer APK v2 verification for the local native-client profile.
// Verifies signer/public key, signature and Android's chunked content digest.
export async function verifyApkV2(file) {
  const z=await Zip.load(file);let cd,end;
  try{cd=z.directoryOffset;end=z.endOffset;}finally{await z.close();}
  const apk=await readFile(file);
  if(cd<32||apk.toString('ascii',cd-16,cd)!=='APK Sig Block 42')throw Error('Missing APK signing block');
  const size=Number(apk.readBigUInt64LE(cd-24)),start=cd-size-8;
  if(!Number.isSafeInteger(size)||start<0||apk.readBigUInt64LE(start)!==BigInt(size))throw Error('Invalid APK signing block');
  let v2=null;const blockIds=new Set();
  for(let p=start+8;p<cd-24;) {
    const n=Number(apk.readBigUInt64LE(p));p+=8;
    if(n<4||p+n>cd-24)throw Error('Invalid signing block pair');
    const blockId=apk.readUInt32LE(p);if(blockIds.has(blockId))throw Error('Duplicate signing block');blockIds.add(blockId);
    if(blockId===0x7109871a){v2=apk.subarray(p+4,p+n);}p+=n;
  }
  if(!v2)throw Error('APK v2 signing block required');
  const outer=fields(v2);if(outer.length!==1)throw Error('Invalid v2 signer sequence');
  const signers=fields(outer[0]);if(signers.length!==1)throw Error('Only a single APK signer is supported');
  const signer=fields(signers[0]);if(signer.length!==3)throw Error('Invalid signer');
  const [signed,signatures,pubkey]=signer,parts=fields(signed);
  if(parts.length!==3&&!(parts.length===4&&parts[3].length===0))throw Error('Invalid signed data');
  for(const attr of fields(parts[2]))if(attr.length===8&&attr.readUInt32LE(0)===0xbeeff00d&&attr.readUInt32LE(4)===3&&!blockIds.has(0xf05368c0))throw Error('Advertised APK v3 signing block was stripped');
  const certs=fields(parts[1]);if(!certs.length)throw Error('Missing signer certificate');
  const certificate=new X509Certificate(certs[0]),key=createPublicKey({key:pubkey,format:'der',type:'spki'});
  if(!certificate.publicKey.export({format:'der',type:'spki'}).equals(pubkey))throw Error('Certificate/key mismatch');
  const supported=new Map([[0x0101,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}],[0x0103,{key,padding:constants.RSA_PKCS1_PADDING}],[0x0201,key],[0x0301,key]]);
  const sigs=fields(signatures),digests=fields(parts[0]);
  const sig=sigs.find(b=>b.length>=4&&supported.has(b.readUInt32LE(0)));
  if(!sig)throw Error('Unsupported APK signature algorithm');
  const id=sig.readUInt32LE(0),sigField=fields(sig.subarray(4));
  if(sigField.length!==1||!verify('sha256',signed,supported.get(id),sigField[0]))throw Error('APK signature verification failed');
  const dg=digests.find(b=>b.length>=4&&b.readUInt32LE(0)===id),expected=dg&&fields(dg.subarray(4));
  if(!expected||expected.length!==1)throw Error('Missing APK content digest');
  const eocd=Buffer.from(apk.subarray(end));eocd.writeUInt32LE(start,16);
  const actual=digest([apk.subarray(0,start),apk.subarray(cd,end),eocd]);
  if(!actual.equals(expected[0]))throw Error('APK signed content digest mismatch');
  return {scheme:'APK v2',signatureVerified:true,contentDigestVerified:true,algorithm:`0x${id.toString(16)}`,certificateSHA256:hash(certs[0]).toString('hex'),subject:certificate.subject,independentPublisherIdentityVerified:false};
}
