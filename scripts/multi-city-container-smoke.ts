import {installBundledCatalog} from '../src/catalog-bootstrap.js';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const transport=spawnSync('curl',['--version'],{encoding:'utf8',timeout:5000});
assert.equal(transport.status,0,'OPERATOR_CURL_REQUIRED');console.log(JSON.stringify({operatorTransport:transport.stdout.split('\n')[0],networkRequests:0}));
const hash=process.argv[2];if(!hash)throw Error('BUNDLED_HASH_REQUIRED');
console.log(JSON.stringify(installBundledCatalog(hash)));
// Полный UI/SQLite smoke записан отдельно; эта delta проверяет упаковку и CLI.
process.argv=[process.argv[0]!,process.argv[1]!,'runtime/catalog/active.json','runtime/evidence','matrix'];
await import('./multi-city-verify.js');
