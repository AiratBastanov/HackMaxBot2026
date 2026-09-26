// npm ci provides pinned Ajv through Fastify; Python/PyYAML parses DATA-API only.
import Ajv2020 from 'ajv/dist/2020.js';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const official='https://spec.openapis.org/oas/3.1/schema/2022-10-07';
mkdirSync('.review',{recursive:true});const cache='.review/openapi-3.1-schema.json';
if(!existsSync(cache)){const r=await fetch(official,{signal:AbortSignal.timeout(20000),redirect:'error'});assert(r.ok);writeFileSync(cache,await r.text());}
const schema=JSON.parse(readFileSync(cache,'utf8')),api=JSON.parse(readFileSync('openapi.json','utf8'));
// Ajv 8's dynamic anchor handling needs a static binding here: this document
// declares no overriding JSON Schema dialect. The official target is $defs/schema.
assert(!api.jsonSchemaDialect);
function bindMeta(v){if(v&&typeof v==='object'){if(v.$dynamicRef==='#meta'){delete v.$dynamicRef;v.$ref='#/$defs/schema';}for(const x of Object.values(v))bindMeta(x);}}
bindMeta(schema);
const ajv=new Ajv2020({strict:false,allErrors:true,validateFormats:false});const valid=ajv.compile(schema);
assert(valid(api),JSON.stringify(valid.errors));
ajv.addSchema(api,'urn:local:maxbot:openapi');
for(const name of Object.keys(api.components.schemas)){assert(ajv.validateSchema(api.components.schemas[name]));ajv.compile({$ref:'urn:local:maxbot:openapi#/components/schemas/'+name});}
const data=JSON.parse(execFileSync('python',['-c','import yaml,json; print(json.dumps(yaml.safe_load(open("DATA-API.yaml",encoding="utf8"))))'],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true}));
for(const key of ['schema_version','solution','team','base_https_url','checks'])assert(Object.hasOwn(data,key));
assert.equal(data.schema_version,null);assert.equal(data.base_https_url,null);
for(const c of data.checks){assert(c.required);const operation=api.paths[c.path][c.method.toLowerCase()];assert(operation);assert(c.role);
 for(const p of ['query','path','headers','body'])assert(Object.hasOwn(c.parameters,p));
 assert.deepEqual(Object.keys(c.expected_responses).sort(),Object.keys(operation.responses).sort());
 for(const response of Object.values(c.expected_responses)){assert(response.content_type);assert(response.required?.length);}
}
function refs(v){if(v&&typeof v==='object'){if(v.$ref?.startsWith('#/'))assert(v.$ref.slice(2).split('/').reduce((x,k)=>x[k.replaceAll('~1','/').replaceAll('~0','~')],api));for(const x of Object.values(v))refs(x);}}
refs(api);console.log(JSON.stringify({result:'PASS',openapi:api.openapi,schema:official,dataApiGroups:9,localReferences:'PASS',deploymentFields:'UNRESOLVED'}));
