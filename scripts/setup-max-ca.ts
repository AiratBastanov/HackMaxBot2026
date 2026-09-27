import {X509Certificate} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

// Файл Госуслуг; доверие только для явно запускаемого Node, без изменения Windows.
const url='https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt';
const fingerprint='D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31';
try {
  const target=process.argv[2]??'secrets/max-official-root.pem',exists=existsSync(target);
  let bytes:Buffer;
  if(exists)bytes=readFileSync(target);
  else {
    const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error('CA_DOWNLOAD_FAILED');
    bytes=Buffer.from(await r.arrayBuffer());
    if(bytes.length>16000)throw Error('CA_SIZE');
  }
  const cert=new X509Certificate(bytes);
  if(!cert.ca||cert.fingerprint256!==fingerprint||Date.parse(cert.validTo)<=Date.now()||Date.parse(cert.validFrom)>Date.now())throw Error('CA_NOT_VERIFIED');
  if(!exists){mkdirSync(dirname(target),{recursive:true});writeFileSync(target,cert.toString(),{flag:'wx',mode:0o644});}
  console.log(JSON.stringify({operation:'CA_READY',subject:'Russian Trusted Root CA',fingerprint256:cert.fingerprint256,path:target,reused:exists}));
}catch {console.error('CA_SETUP_FAILED: проверьте HTTPS-доступ к Госуслугам, путь и официальный отпечаток сертификата. Существующий файл не изменён.');process.exitCode=1;}
