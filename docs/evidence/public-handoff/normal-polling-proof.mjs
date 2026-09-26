import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import Database from '/app/node_modules/better-sqlite3/lib/index.js';
globalThis.fetch=async(url,options)=>{
 assert.equal(options.headers.Authorization,'synthetic-isolated-no-live-token');
 const u=new URL(url);assert.equal(u.origin,'https://platform-api2.max.ru');
 if(u.pathname==='/me')return new Response('{"user_id":777,"is_bot":true,"first_name":"Fixture"}');
 if(u.pathname==='/subscriptions')return new Response('{"subscriptions":[]}');
 if(u.pathname==='/updates')return new Response('{"updates":[],"marker":9007199254740993}');
 throw Error('UNEXPECTED_NETWORK_OPERATION');
};
setTimeout(()=>{
 try{
 const db=new Database('/app/runtime/public-proof.sqlite',{readonly:true});
 assert.equal(JSON.parse(db.prepare("SELECT value FROM meta WHERE key='poll_marker'").get().value),'9007199254740993');
 assert.equal(db.prepare("SELECT value FROM meta WHERE key='poll_campaign'").get(),undefined);db.close();
 assert(existsSync('/app/runtime/catalog/active.json'));
 assert.equal(readFileSync('/app/runtime/catalog/active.json','utf8'),readFileSync('/app/catalog/real/active.json','utf8'));
 console.log(JSON.stringify({proof:'NORMAL_POLLING_ENTRYPOINT',result:'PASS',network:'NONE',seed:'UNCHANGED',cursor:'LOSSLESS'}));
 process.kill(process.pid,'SIGTERM');
 }catch(e){console.error(e);process.exit(1);}
},1800);
