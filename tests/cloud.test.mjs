import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {stateEndpoint} from '../server/state.js';
import {createCloudStore} from '../public/cloud.js';
const base=[{id:'A',name:'First Coffee',city:'Berlin',lastActivity:'PRIVATE DATE',directions:9,googleIds:['PRIVATE ID']},{id:'B',name:'Second Coffee'},{id:'C',name:'Unconfirmed Secret Coffee'}];
function fixture() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../drizzle/0000_thankful_wraith.sql',import.meta.url),'utf8'));
  const db={prepare:sql=>({bind:(...args)=>({first:async()=>sqlite.prepare(sql).get(...args)??null})})};
  const request=(method='GET',body,identity='owner',origin='https://cafe.test')=>new Request('https://cafe.test/api/state',{method,headers:{...(identity?{'oai-authenticated-user-id':identity,'oai-authenticated-user-email':identity==='other'?'someone@example.com':'owner@example.test'}:{}),origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const endpoint=req=>stateEndpoint(req,db,base,'owner@example.test');
  const client=()=>createCloudStore(async(path,options={})=>endpoint(request(options.method||'GET',options.body?JSON.parse(options.body):undefined)));
  return {endpoint,request,client,close:()=>sqlite.close()};
}
test('two device sessions see one saved collection and stale writes merge without loss',async()=>{
  const f=fixture();try{
    const a=f.client(),b=f.client();await a.load();await b.load();
    await a.change(state=>{state.events.push({type:'vote',winner:'A',loser:'B'});return state;});
    await b.change(state=>{state.events.push({type:'exclude',id:'C'});return state;});
    const latest=await a.load();assert.equal(latest.state.events.length,2);assert.equal(latest.revision,2);
    assert.equal(latest.state.events[0].winner,'A');assert.equal(latest.state.events[1].id,'C');
    const fresh=await f.client().load();assert.deepEqual(fresh.state,latest.state);
  }finally{f.close();}
});
test('public visitors receive ranked branches only, without activity evidence or choices',async()=>{
  const f=fixture();try{
    const owner=f.client();await owner.load();await owner.change(s=>{s.events.push({type:'vote',winner:'A',loser:'B'});return s;});
    const response=await f.endpoint(f.request('GET',undefined,null));const shared=await response.json();
    assert.equal(shared.canEdit,false);assert.equal(shared.cafes.length,2);assert.equal(shared.ranking[0].id,'A');
    const text=JSON.stringify(shared);assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes('Unconfirmed'));assert.ok(!('state'in shared));
  }finally{f.close();}
});
test('anonymous, other accounts, changed owner IDs and cross-origin writes cannot edit',async()=>{
  const f=fixture();try{
    const body={app:'cafe-index',version:1,events:[],addedCafes:[],revision:0};
    assert.equal((await f.endpoint(f.request('PUT',body,null))).status,403);
    assert.equal((await f.endpoint(f.request('PUT',body,'other'))).status,403);
    assert.equal((await f.endpoint(f.request('PUT',body,'owner','https://untrusted.test'))).status,403);
    assert.equal((await f.endpoint(f.request('PUT',body))).status,200);
    assert.equal((await f.endpoint(f.request('PUT',{...body,revision:1},'changed-owner-id'))).status,403);
    assert.equal((await f.endpoint(f.request('PUT',body))).status,409);
  }finally{f.close();}
});
test('failed storage never returns a successful save',async()=>{
  const response=await stateEndpoint(new Request('https://cafe.test/api/state'),null,base);assert.equal(response.status,503);
});
