import { resolve } from 'node:path';
import { prepareCatalog,preparationError } from '../src/catalog-prepare.js';

// Не загружает конфигурацию MAX и не открывает SQLite. Один владелец — catalog-init.
prepareCatalog({bundled:resolve('catalog/real'),destination:resolve('runtime/catalog'),cacheRoot:resolve('runtime/source-cache/bootstrap'),
  mode:process.env.FLOW_DATA_MODE==='synthetic-test'?'synthetic-test':'real',report:message=>console.log(message)})
  .then(result=>console.log(JSON.stringify({operation:'catalog_prepared',...result})))
  .catch(()=>{console.error(preparationError);process.exitCode=1;});
