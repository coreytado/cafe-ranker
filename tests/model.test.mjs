import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRanking, choosePair, mergeCafes, validateBackup, parseMapsActivity } from '../public/model.js';
const cafes = ['A','B','C','D'].map((id,i) => ({ id, name: id, directions: i < 2 ? 1 : 0, lastActivity: `2026-10-${20-i}`, googleIds: [`pid-${id}`] }));
const vote = (winner,loser) => ({ type:'vote',winner,loser });
test('rankings start empty, then conserve total rating and reflect choices', () => {
  assert.equal(computeRanking(cafes,[]).ranked.length,0);
  const r = computeRanking(cafes,[vote('A','B'),vote('A','C')]);
  assert.equal(r.ranked[0].id,'A'); assert.equal(r.scores.get('A').wins,2);
  assert.ok(Math.abs([...r.scores.values()].reduce((sum,c) => sum+c.rating,0)-4500)<0.000001);
});
test('removing a venue removes its comparisons and influence; restore replays them', () => {
  const events = [vote('A','B'),vote('B','C')];
  const before = computeRanking(cafes,events);
  const removed = computeRanking(cafes,[...events,{type:'exclude',id:'B'}]);
  assert.equal(removed.ranked.length,0); assert.equal(removed.active.length,3);
  const restored = computeRanking(cafes,[...events,{type:'exclude',id:'B'},{type:'restore',id:'B'}]);
  assert.deepEqual(restored.ranked,before.ranked);
});
test('pairing promotes recent routed candidates, introduces new cafés, excludes removed cafés', () => {
  assert.deepEqual(choosePair(cafes,[]),['A','B']);
  const events = [vote('A','B')];
  const next = choosePair(cafes,events,['A','B']);
  assert.ok(next.includes('C')); assert.equal(new Set(next).size,2);
  assert.ok(!choosePair(cafes,[...events,{type:'exclude',id:'C'}]).includes('C'));
  assert.deepEqual(choosePair(cafes.slice(0,1),[]),[]);
});
test('branches stay separate while matching Google IDs prevent duplicate imports', () => {
  const result = mergeCafes(cafes,[{id:'X',name:'same venue',googleIds:['pid-A']},{id:'E',name:'A',googleIds:['pid-E']}]);
  assert.equal(result.added,1); assert.equal(result.cafes.length,5);
});
test('backups validate before replacement', () => {
  const backup = { app:'cafe-index',version:1,events:[vote('A','B')],addedCafes:[] };
  assert.equal(validateBackup(backup).events.length,1);
  assert.throws(() => validateBackup({...backup,events:[{type:'clear'}]}));
  assert.throws(() => validateBackup({...backup,addedCafes:[{id:'X',name:'X',googleIds:'bad'}]}));
});
test('Maps import requires named POI evidence and never turns a route origin into its destination', () => {
  const poi = {title:'Viewed Good Coffee',titleUrl:'https://maps.google.com/?q=Good+Coffee,+10+Main+St,+Salem,+OR+97302&ftid=0x123:0xabc',time:'2026-10-28T12:00:00Z'};
  const route = {title:'Directions to Good Coffee, Salem, OR',titleUrl:'https://www.google.com/maps/dir//Good+Coffee/!1s0x123:0xabc'};
  const home = {title:'Directions to Home',titleUrl:'https://www.google.com/maps/dir/Good+Coffee/Home/!1s0x123:0xabc'};
  const generic = {title:'Searched for coffee near me',titleUrl:'https://maps.google.com/?q=coffee+near+me&ftid=0x123:0xdef'};
  const parsed = parseMapsActivity([poi,route,home,generic]);
  assert.equal(parsed.length,1); assert.equal(parsed[0].name,'Good Coffee'); assert.equal(parsed[0].directions,1); assert.equal(parsed[0].city,'Salem');
  assert.equal(parseMapsActivity([route]).length,0);
  assert.throws(() => parseMapsActivity({timeline:[]}));
});
