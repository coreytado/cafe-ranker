import { STORAGE_KEY, computeRanking, choosePair, mergeCafes, validateBackup, parseMapsActivity } from './model.js';
import {createCloudStore} from './cloud.js';

const $ = id => document.getElementById(id);
const icons = {
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--paper)"/><circle cx="15" cy="17" r="3" fill="var(--paper)"/></svg>',
  cup: '<svg viewBox="0 0 24 24"><path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm13 1h2a3 3 0 0 1 0 6h-2M7 4v1m5-2v2"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>'
};
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  children.flat().filter(c => c !== null && c !== undefined).forEach(c => node.append(c instanceof Node ? c : document.createTextNode(String(c))));
  return node;
}
const icon = name => { const span = el('span', { 'aria-hidden': 'true' }); span.innerHTML = icons[name]; return span; };
const safeUrl = (value, fallback = '#') => { try { const u = new URL(value, location.origin); return ['https:', 'http:'].includes(u.protocol) ? u.href : fallback; } catch { return fallback; } };
const localPhoto = cafe => /^\/assets\/photos\/[a-z0-9-]+\.jpg$/.test(cafe.photo || '') ? cafe.photo : null;
const where = cafe => [cafe.city, cafe.country].filter(Boolean).join(', ') || 'Location not recorded';
const mapsLink = cafe => safeUrl(cafe.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([cafe.name, cafe.address, cafe.city].filter(Boolean).join(', '))}`);
let base = [], cafes = [], data, pair = [], view = 'compare', map, markerLayer, mapList = [], toastTimer;
let canEdit = false, working = false, sharedRanking = [];
const cloud = createCloudStore();
let state = { events: [], addedCafes: [] };
function busy(value) {
  working=value;
  document.querySelectorAll('.card-choice,.choose-button,.havent-button,#undo-button,#add-form button,.manage-row button,#restore-button,#import-maps-button,#transfer-button').forEach(n=>n.disabled=value);
  if (!value) $('undo-button').disabled=!state.events.length;
}
async function saveChange(mutator,message) {
  if (!canEdit || working) return false;
  busy(true); $('storage-note').textContent='Saving to your collection…';
  try {
    const saved=await cloud.change(mutator); state=saved.state; refresh();
    $('storage-note').textContent='Saved online · available on every device';
    if (message) toast(message); return true;
  } catch(error) { $('storage-note').textContent='Save not confirmed · please retry'; toast(error.message); return false; }
  finally {busy(false);}
}
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('visible'); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 4000); }
function refresh(next = true) {
  cafes = mergeCafes(base, state.addedCafes).cafes;
  data = computeRanking(cafes, state.events);
  if (!canEdit) { data.ranked=sharedRanking; data.scores=new Map(sharedRanking.map(s=>[s.id,s])); data.positions=new Map(sharedRanking.map((s,i)=>[s.id,i+1])); }
  if (canEdit && (next || pair.some(id => data.excluded.has(id)))) pair = choosePair(cafes, state.events, pair);
  $('collection-count').textContent = `${data.active.length} café candidates`;
  $('ranked-count').textContent = `${data.ranked.length} ranked · one worldwide list`;
  $('nav-count').textContent = data.ranked.length;
  $('comparison-count').textContent = `${data.votes.length} comparison${data.votes.length === 1 ? '' : 's'} made`;
  $('undo-button').disabled = !state.events.length;
  $('settings-total').textContent = cafes.length;
  $('settings-votes').textContent = data.votes.length;
  $('settings-excluded').textContent = cafes.filter(c => data.excluded.has(c.id)).length;
  populateFilters('ranking'); populateFilters('map');
  if (canEdit) {renderCompare();renderManage();} renderRanking();
  if (view === 'map') renderMap();
}
function action(event, message) {
  const entry={...event,at:new Date().toISOString(),eventId:crypto.randomUUID()};
  return saveChange(current=>{if(!current.events.some(e=>e.eventId===entry.eventId))current.events.push(entry);return current;},message);
}
function vote(winner) {
  if (!canEdit || working || pair.length !== 2 || !pair.includes(winner)) return;
  const loser = pair.find(id => id !== winner);
  action({ type: 'vote', winner, loser }, 'Choice saved. Your ranking is taking shape.');
}
function exclude(id) { const cafe = cafes.find(c => c.id === id); action({ type: 'exclude', id }, `${cafe.name} removed. You can undo or restore it in your collection.`); }
function photo(cafe, className = 'list-photo') {
  const src = localPhoto(cafe);
  if (src) {
    const img = el('img', { class: className, src, alt: `${cafe.name} café`, loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('span', { class: `${className} list-placeholder`, 'aria-label': 'Photo not available' }, cafe.name[0] || 'c')));
    return img;
  }
  return el('span', { class: `${className} list-placeholder`, 'aria-label': 'Photo not available' }, cafe.name[0] || 'c');
}
function empty(title, copy, buttonText, callback) {
  return el('div', { class: 'empty-state' }, el('div', { class: 'empty-icon' }, icon('cup')), el('h2', {}, title), el('p', {}, copy), buttonText ? el('button', { class: 'button button-dark', onClick: callback }, buttonText, icon('arrow')) : null);
}
function renderCompare() {
  const container = $('comparison'); container.replaceChildren();
  container.classList.toggle('no-pair', pair.length !== 2);
  if (pair.length !== 2) { container.append(empty('A little more coffee first.', 'You need at least two cafés in your collection to compare them.', 'Add a café', () => openDialog('add-dialog'))); return; }
  pair.forEach((id, index) => {
    const cafe = cafes.find(c => c.id === id), position = data.positions.get(id), src = localPhoto(cafe);
    const picture = el('div', { class: 'photo-wrap' });
    if (src) picture.append(photo(cafe, 'card-photo'));
    else picture.append(el('div', { class: 'photo-placeholder' }, el('span', { class: 'placeholder-letter', 'aria-hidden': 'true' }, cafe.name[0]), el('span', {}, 'Photo not available')));
    picture.append(el('span', { class: 'photo-tag' }, position ? `No. ${position} in your ranking` : 'Not yet ranked'));
    const choice = el('button', { class: 'card-choice', 'aria-label': `Choose ${cafe.name}, ${where(cafe)}`, onClick: () => vote(id) }, picture, el('div', { class: 'card-content' }, el('p', { class: 'card-city' }, where(cafe)), el('h2', { class: 'card-name' }, cafe.name), el('p', { class: 'card-address' }, cafe.address || 'Branch address not recorded')));
    const card = el('article', { class: 'cafe-card' }, choice,
      el('div', { class: 'card-bottom' }, el('button', { class: 'havent-button', 'aria-label': `I haven't been to ${cafe.name}`, onClick: () => exclude(id) }, 'Haven’t been here'), el('button', { class: 'choose-button', onClick: () => vote(id) }, 'Choose this café', icon('arrow'))),
      el('div', { class: 'photo-source' }, src ? el('a', { href: safeUrl(cafe.photoSource), target: '_blank', rel: 'noopener noreferrer', title: cafe.photoCredit || 'Photo source' }, `Photo: ${cafe.photoCredit || 'café website'} ↗`) : 'A real café photo will appear here when available.'));
    container.append(card);
  });
}
function showView(next) {
  view = ['compare', 'ranking', 'map'].includes(next) ? next : 'compare';
  if (!canEdit && view==='compare') view='ranking';
  document.querySelectorAll('.view').forEach(n => n.hidden = n.id !== `${view}-view`);
  document.querySelectorAll('[data-view]').forEach(n => { n.classList.toggle('active', n.dataset.view === view); if (n.dataset.view === view) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); });
  history.replaceState(null, '', `#${view}`);
  if (view === 'ranking') renderRanking();
  if (view === 'map') { initMap(); setTimeout(() => { map?.invalidateSize(); renderMap(true); }, 50); }
}
function populateFilters(prefix) {
  const country = $(`${prefix}-country`), city = $(`${prefix}-city`);
  const fill = (node, values, label) => { const selected = node.value; node.replaceChildren(el('option', { value: '' }, label), ...values.map(value => el('option', { value }, value))); if (values.includes(selected)) node.value = selected; };
  fill(country, [...new Set(data.active.map(c => c.country).filter(Boolean))].sort(), 'All countries');
  fill(city, [...new Set(data.active.filter(c => !country.value || c.country === country.value).map(c => c.city).filter(Boolean))].sort(), 'All cities');
}
function matches(cafe, prefix) {
  const search = $(`${prefix}-search`).value.toLocaleLowerCase().trim();
  return (!$(`${prefix}-country`).value || cafe.country === $(`${prefix}-country`).value) && (!$(`${prefix}-city`).value || cafe.city === $(`${prefix}-city`).value) && (!search || [cafe.name, cafe.city, cafe.country, cafe.address].join(' ').toLocaleLowerCase().includes(search));
}
function compareCafe(id) {
  if (!canEdit) return;
  const other = data.active.filter(c => c.id !== id).sort((a,b) => Math.abs((data.scores.get(a.id)?.rating || 1500) - (data.scores.get(id)?.rating || 1500)) - Math.abs((data.scores.get(b.id)?.rating || 1500) - (data.scores.get(id)?.rating || 1500)))[0];
  if (!other) { toast('Add another café to compare.'); return; }
  pair = [id, other.id]; renderCompare(); showView('compare'); window.scrollTo(0, 0);
}
function renderRanking() {
  const ranked = data.ranked.map(s => ({ ...cafes.find(c => c.id === s.id), score: s })).filter(c => matches(c, 'ranking'));
  $('ranking-summary').textContent = `${ranked.length} of ${data.ranked.length} ranked`;
  const content = $('ranking-content'); content.replaceChildren();
  if (!data.ranked.length) { content.append(canEdit ? empty('Your ranking starts with a choice.', 'Compare two cafés and they’ll take their first places here. Every choice helps find your favourites.', 'Make your first comparison', () => showView('compare')) : empty('The first choices are still brewing.', 'Corey hasn’t ranked any cafés yet. Check back after the first comparisons.')); return; }
  if (!ranked.length) { content.append(empty('No cafés match those filters.', 'Try another city, country or café name.')); return; }
  const table = el('table', { class: 'ranking-table' }), body = el('tbody');
  table.append(el('thead', {}, el('tr', {}, ['RANK', 'CAFÉ & BRANCH', 'LOCATION', 'COMPARISONS', ''].map(text => el('th', { scope: 'col' }, text)))), body);
  ranked.forEach(cafe => body.append(el('tr', {}, el('td', { class: 'rank-number' }, String(data.positions.get(cafe.id)).padStart(2, '0')), el('td', {}, el('div', { class: 'rank-shop' }, photo(cafe), el('div', {}, el('strong', {}, cafe.name), el('small', {}, cafe.address || 'Address not recorded')))), el('td', { class: 'rank-location' }, cafe.city || 'Not recorded', el('br'), cafe.country || ''), el('td', { class: 'rank-stat' }, cafe.score.played), el('td', { class: 'rank-actions' }, canEdit ? el('button', { class: 'text-button', onClick: () => compareCafe(cafe.id) }, 'Compare again ↗') : null))));
  content.append(table);
}
function openDialog(id) { document.querySelectorAll('dialog[open]').forEach(d => d.close()); if (id === 'manage-dialog') renderManage(); $(id).showModal(); }
function renderManage() {
  if (!data) return;
  const removed = $('manage-scope').value === 'removed', search = $('manage-search').value.toLocaleLowerCase().trim();
  const list = cafes.filter(c => data.excluded.has(c.id) === removed && (!search || [c.name, c.address, c.city, c.country].join(' ').toLocaleLowerCase().includes(search)));
  $('manage-results').replaceChildren(el('p', { class: 'manage-count' }, `${list.length} cafés${list.length > 150 ? ' · showing the first 150; search to narrow the list' : ''}`), ...list.slice(0,150).map(c => el('div', { class: 'manage-row' }, el('div', {}, el('strong', {}, c.name), el('p', {}, [c.address, where(c)].filter(Boolean).join(' · '))), el('button', { class: 'text-button', onClick: () => removed ? action({ type: 'restore', id: c.id }, `${c.name} restored.`) : exclude(c.id) }, removed ? 'Restore café' : 'Haven’t been'))));
}
function backup() {
  const blob = new Blob([JSON.stringify({ app: 'cafe-index', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = el('a', { href: url, download: `cafe-index-backup-${new Date().toISOString().slice(0,10)}.json` }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup exported. Keep it somewhere safe.');
}
function initMap() {
  if (map) return;
  if (!window.L) { $('map').replaceChildren(el('div', { class: 'map-failed' }, 'The map couldn’t load. Check your internet connection, then reload the page.')); return; }
  $('map-loading')?.remove();
  map = L.map('map', { scrollWheelZoom: false }).setView([32, -15], 2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('zoomend', drawMarkers);
}
function popup(cafe) {
  const result = el('div', { class: 'popup-content' }), rank = data.positions.get(cafe.id);
  if (localPhoto(cafe)) result.append(photo(cafe, 'popup-photo'));
  result.append(el('span', { class: 'popup-rank' }, rank ? `No. ${rank} in your ranking` : 'Not yet ranked'), el('h3', {}, cafe.name), el('p', {}, cafe.address || where(cafe)));
  if (cafe.locationPrecision === 'approximate') result.append(el('p', {}, 'Approximate map point from your export.'));
  result.append(canEdit ? el('button', { class: 'button button-dark', onClick: () => compareCafe(cafe.id) }, 'Compare this café') : null, el('a', { href: mapsLink(cafe), target: '_blank', rel: 'noopener noreferrer' }, 'Open in Google Maps ↗'));
  if (localPhoto(cafe)) result.append(el('p', {}, el('a', { href: safeUrl(cafe.photoSource), target: '_blank', rel: 'noopener noreferrer' }, 'Photo source ↗')));
  return result;
}
function locate(cafe) { if (!map) return; map.setView([cafe.lat, cafe.lng], 16); L.popup({ maxWidth: 245 }).setLatLng([cafe.lat, cafe.lng]).setContent(popup(cafe)).openOn(map); }
function drawMarkers() {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  const groups = new Map();
  mapList.forEach(cafe => { const p = map.project([cafe.lat, cafe.lng], map.getZoom()), key = `${Math.floor(p.x/48)}:${Math.floor(p.y/48)}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(cafe); });
  groups.forEach(group => {
    if (group.length > 1 && map.getZoom() < 17) {
      const centre = [group.reduce((s,c) => s+c.lat,0)/group.length, group.reduce((s,c) => s+c.lng,0)/group.length];
      const marker = L.marker(centre, { icon: L.divIcon({ className: 'cluster-pin', html: String(group.length), iconSize: [33,33] }), title: `${group.length} cafés` }).addTo(markerLayer);
      marker.on('click', () => map.fitBounds(group.map(c => [c.lat,c.lng]), { padding: [45,45], maxZoom: 17 }));
    } else group.forEach(cafe => {
      const rank = data.positions.get(cafe.id), size = rank ? 26 : 12;
      const marker = L.marker([cafe.lat,cafe.lng], { icon: L.divIcon({ className: `cafe-pin${rank ? ' ranked-pin' : ''}`, html: rank ? String(rank) : '', iconSize: [size,size] }), title: cafe.name, alt: cafe.name }).addTo(markerLayer);
      marker.bindPopup(() => popup(cafe), { maxWidth: 245 });
    });
  });
}
function renderMap(fit = false) {
  const allMapped = data.active.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180);
  const scope = $('map-scope').value;
  mapList = allMapped.filter(c => matches(c, 'map') && (scope === 'all' || (scope === 'ranked' ? data.positions.has(c.id) : !data.positions.has(c.id))));
  $('mapped-count').textContent = `${allMapped.length} of ${data.active.length} cafés have map locations`;
  $('map-result-count').textContent = `${mapList.length} cafés on the map`;
  $('map-results').replaceChildren(...(mapList.length ? mapList.slice(0,100).map(c => el('button', { class: 'map-result', onClick: () => locate(c) }, photo(c), el('span', {}, el('strong', {}, c.name), el('small', {}, c.city || 'Location in export')), el('span', { class: 'result-rank' }, data.positions.has(c.id) ? `#${data.positions.get(c.id)}` : '—'))) : [el('p', { class: 'map-list-empty' }, 'No mapped cafés match these filters.')]));
  if (mapList.length > 100) $('map-results').append(el('p', { class: 'map-list-empty' }, 'Showing the first 100. Search or filter to find more.'));
  drawMarkers();
  if (fit && map && mapList.length) map.fitBounds(mapList.map(c => [c.lat,c.lng]), { padding: [25,25], maxZoom: 14 });
}
function bind() {
  $('settings-button').append(icon('settings')); $('strip-icon').append(icon('cup'));
  document.querySelectorAll('.search-icon').forEach(n => n.append(icon('search')));
  document.querySelectorAll('[data-view]').forEach(n => n.addEventListener('click', () => showView(n.dataset.view)));
  document.querySelector('.wordmark').addEventListener('click', e => { e.preventDefault(); showView('compare'); });
  $('ranking-compare').addEventListener('click', () => showView('compare'));
  $('settings-button').addEventListener('click', () => openDialog('settings-dialog'));
  ['manage-button','open-manage-button'].forEach(id => $(id).addEventListener('click', () => openDialog('manage-dialog')));
  $('add-cafe-button').addEventListener('click', () => openDialog('add-dialog'));
  document.querySelectorAll('.close-dialog').forEach(n => n.addEventListener('click', () => n.closest('dialog').close()));
  $('undo-button').addEventListener('click', () => saveChange(current=>{current.events.pop();return current;},'Last choice undone.'));
  ['backup-button','settings-export'].forEach(id => $(id).addEventListener('click', backup));
  $('restore-button').addEventListener('click', () => $('restore-file').click());
  $('import-maps-button').addEventListener('click', () => $('maps-file').click());
  $('restore-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try { if (file.size > 20000000) throw new Error('Choose a backup smaller than 20 MB.'); const restored = validateBackup(JSON.parse(await file.text())); if (await saveChange(()=>restored,'Backup restored to your online collection.')) $('settings-dialog').close(); }
    catch (error) { toast(error.message || 'That backup could not be read.'); } e.target.value = '';
  });
  $('maps-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 150000000) throw new Error('Choose a Maps export smaller than 150 MB.');
      const incoming = parseMapsActivity(JSON.parse(await file.text()));
      const result = mergeCafes(cafes, incoming);
      await saveChange(current=>{current.addedCafes=mergeCafes(current.addedCafes,incoming.filter(c=>!base.some(b=>b.id===c.id || b.googleIds?.some(id=>c.googleIds?.includes(id))))).cafes;return current;},`${result.added} new café candidates saved online. Visits still need your confirmation.`);
    } catch (error) { toast(error.message || 'That Maps file could not be read.'); } e.target.value = '';
  });
  $('add-form').addEventListener('submit', async e => {
    e.preventDefault(); const form = new FormData(e.target);
    const cafe = { id: `manual-${crypto.randomUUID()}`, name: form.get('name').trim(), city: form.get('city').trim(), country: form.get('country').trim(), address: form.get('address').trim(), googleIds: [], directions: 0, lastActivity: new Date().toISOString().slice(0,10), lat: null, lng: null, locationPrecision: 'unknown' };
    if (!cafe.name || !cafe.city || !cafe.country) { toast('Add a name, city and country.'); return; }
    if(await saveChange(current=>{current.addedCafes=mergeCafes(current.addedCafes,[cafe]).cafes;return current;},`${cafe.name} saved online.`)){ $('add-dialog').close();e.target.reset();compareCafe(cafe.id); }
  });
  ['ranking','map'].forEach(prefix => {
    $(`${prefix}-search`).addEventListener('input', () => prefix === 'ranking' ? renderRanking() : renderMap(true));
    ['country','city'].forEach(field => $(`${prefix}-${field}`).addEventListener('change', () => { if (field === 'country') { $(`${prefix}-city`).value = ''; populateFilters(prefix); } prefix === 'ranking' ? renderRanking() : renderMap(true); }));
  });
  $('map-scope').addEventListener('change', () => renderMap(true));
  ['manage-search','manage-scope'].forEach(id => $(id).addEventListener(id.endsWith('search') ? 'input' : 'change', renderManage));
  document.addEventListener('keydown', e => { if (view !== 'compare' || document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return; if (e.key === '1' || e.key === '2') { e.preventDefault(); vote(pair[Number(e.key)-1]); } });
}
function migration() {
  if (!canEdit || $('migration-notice')) return;
  let legacy; try {const raw=localStorage.getItem(STORAGE_KEY);if(raw)legacy=validateBackup(JSON.parse(raw));} catch {return;}
  if (!legacy || (!legacy.events.length && !legacy.addedCafes.length)) return;
  const notice=el('div',{id:'migration-notice',class:'migration-notice'},el('p',{},'This browser has choices from the original draft. Transfer them once to make them available everywhere.'),el('button',{id:'transfer-button',class:'button button-dark',onClick:async()=>{
    const okay=await saveChange(current=>{
      const key=e=>JSON.stringify([e.type,e.winner,e.loser,e.id,e.at]);
      const seen=new Set(current.events.map(key));
      current.events.push(...legacy.events.filter(e=>!seen.has(key(e))));
      current.events.sort((a,b)=>(a.at||'').localeCompare(b.at||''));
      current.addedCafes=mergeCafes(current.addedCafes,legacy.addedCafes).cafes;return current;
    },'Previous choices transferred. They now follow you across devices.');
    if(okay){try{localStorage.removeItem(STORAGE_KEY);}catch{}notice.remove();}
  }},'Transfer previous choices'));
  $('compare-view').prepend(notice);
}
function applySnapshot(value) {
  canEdit=value.canEdit;
  if(canEdit) state=value.state; else {base=value.cafes;sharedRanking=value.ranking;state={events:[],addedCafes:[]};}
  document.body.classList.toggle('viewer',!canEdit);
  document.querySelector('.private-label').textContent=canEdit?'Your collection':'Read-only ranking';
  $('owner-signin').hidden=canEdit;
  $('share-button').hidden=!canEdit;
  $('storage-note').textContent=canEdit?'Saved online · available on every device':'Live ranking · read-only';
  if(!canEdit){$('ranking-view').querySelector('h1').textContent='Corey’s café ranking';$('map-view').querySelector('h1').textContent='Corey’s cafés, on the map';}
}
async function syncLatest() {
  if(working || document.hidden || document.querySelector('dialog[open]'))return;
  busy(true);
  try {const latest=await cloud.load();if(latest.canEdit!==canEdit){location.reload();return;}applySnapshot(latest);refresh(false);} catch {$('storage-note').textContent='Connection interrupted · reload to reconnect';} finally {busy(false);}
}
async function start() {
  bind();
  $('share-button').addEventListener('click',async()=>{const url=location.origin+'/#ranking';try{await navigator.clipboard.writeText(url);toast('Ranking link copied. Anyone with it can view; only you can edit.');}catch{toast(url);}});
  try {
    applySnapshot(await cloud.load());
    if(canEdit){const response=await fetch('/cafes.json',{cache:'no-store'});if(!response.ok)throw new Error();base=(await response.json()).cafes;}
    refresh();showView(location.hash.slice(1));migration();
    window.addEventListener('focus',syncLatest);document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncLatest();});setInterval(syncLatest,30000);
  } catch {
    document.body.classList.add('load-failed');
    $('storage-note').textContent='Collection unavailable · please reload';
    $('ranking-content').replaceChildren(empty('The saved ranking couldn’t load.','Check your connection and reload the page. Choices are kept online.'));
    document.querySelectorAll('.view').forEach(n=>n.hidden=n.id!=='ranking-view');
  }
}
start();
