import {copyFileSync,existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const privatePath=new URL('../data/cafes.private.json',import.meta.url);
const examplePath=new URL('../data/cafes.example.json',import.meta.url);
const selected=existsSync(privatePath)?privatePath:examplePath;
const source=JSON.parse(readFileSync(selected,'utf8'));
if(!Array.isArray(source.cafes))throw new Error('The café seed file must contain a cafes array.');
copyFileSync(selected,new URL('../data/cafes.json',import.meta.url));
console.log(`Prepared ${source.cafes.length} café candidates from ${fileURLToPath(selected).split('/').at(-1)}.`);
