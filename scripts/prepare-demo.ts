import {mkdirSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {stage4Fixture} from '../src/culture/stage4-fixture.js';
mkdirSync('runtime',{recursive:true});
writeFileSync('runtime/synthetic-catalog.json',JSON.stringify(stage4Fixture(),null,2)+'\n');
if(!existsSync('.env.demo'))copyFileSync('.env.example','.env.demo');
console.log('Демо подготовлено: .env.demo, runtime/synthetic-catalog.json. MAX симулирован.');
