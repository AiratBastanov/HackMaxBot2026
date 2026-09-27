import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {flowDriver} from './flow-driver.js';
import {anyFixture,combinedJourney} from './any-date-time-scenario.js';
const root=resolve(process.argv[2]??'.review/any-date-time/walkthrough');mkdirSync(root,{recursive:true});
const run=mkdtempSync(resolve(root,'case-')),d=await flowDriver(resolve(run,'disposable.sqlite'),anyFixture(),undefined,false,null,true);
try {
  const frames=await combinedJourney(d);
  writeFileSync(resolve(root,'walkthrough.md'),'# Любая дата и любое время: реальные экраны локального приложения\n\nВымышленный каталог, disposable SQLite, PUBLIC admission, настоящий HTTP/worker/renderer/outbox; MAX симулирован. HUMAN/MAX mobile/web: NOT_RUN.\n'+
    frames.map(f=>'\n## '+f.title+'\n\n```text\n'+f.text+'\n```\n\nКнопки: '+f.buttons.join(' · ')+'\n').join(''));
  const receipt={result:'PASS',transport:'SIMULATED_MAX',frames:frames.length,restart:true,concreteSavedVisit:true,human:'NOT_RUN'};
  writeFileSync(resolve(root,'walkthrough.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally {await d.close();}
