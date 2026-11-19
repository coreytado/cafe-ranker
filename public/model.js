export const STORAGE_KEY = 'cafe-index-v1';
export const DEFAULT_RATING = 1500;
export function excludedIds(events) {
  const ids = new Set();
  for (const event of events) {
    if (event.type === 'exclude') ids.add(event.id);
    if (event.type === 'restore') ids.delete(event.id);
  }
  return ids;
}
export function computeRanking(cafes, events) {
  const excluded = excludedIds(events);
  const known = new Map(cafes.map(cafe => [cafe.id, cafe]));
  const scores = new Map();
  const votes = [];
  const get = id => {
    if (!scores.has(id)) scores.set(id, { id, rating: DEFAULT_RATING, wins: 0, losses: 0, played: 0 });
    return scores.get(id);
  };
  for (const event of events) {
    if (event.type !== 'vote' || event.winner === event.loser || excluded.has(event.winner) || excluded.has(event.loser) || !known.has(event.winner) || !known.has(event.loser)) continue;
    const winner = get(event.winner), loser = get(event.loser);
    const expected = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
    const change = 32 * (1 - expected);
    winner.rating += change; loser.rating -= change;
    winner.wins++; loser.losses++; winner.played++; loser.played++;
    votes.push(event);
  }
  const ranked = [...scores.values()].filter(item => item.played > 0).sort((a, b) => b.rating - a.rating || b.played - a.played || known.get(a.id).name.localeCompare(known.get(b.id).name));
  const positions = new Map(ranked.map((item, index) => [item.id, index + 1]));
  return { scores, ranked, positions, excluded, votes, active: cafes.filter(cafe => !excluded.has(cafe.id)) };
}
export function choosePair(cafes, events, previous = []) {
  const result = computeRanking(cafes, events);
  if (result.active.length < 2) return [];
  const fresh = result.active.filter(cafe => !result.scores.has(cafe.id)).sort((a, b) => Number(b.directions > 0) - Number(a.directions > 0) || (b.lastActivity || '').localeCompare(a.lastActivity || '') || a.name.localeCompare(b.name));
  const ranked = result.ranked.map(item => cafes.find(cafe => cafe.id === item.id));
  let left, right;
  const voteCount = result.votes.length;
  if (fresh.length && (!ranked.length || voteCount % 5 !== 4)) {
    left = fresh[0];
    if (ranked.length) {
      right = ranked.slice().sort((a, b) => Math.abs(result.scores.get(a.id).rating - 1500) - Math.abs(result.scores.get(b.id).rating - 1500) || result.scores.get(a.id).played - result.scores.get(b.id).played)[0];
    } else right = fresh[1] || result.active.find(cafe => cafe.id !== left.id);
  } else {
    const activeRanked = ranked.length > 1 ? ranked : result.active;
    left = activeRanked.slice().sort((a, b) => (result.scores.get(a.id)?.played || 0) - (result.scores.get(b.id)?.played || 0) || a.name.localeCompare(b.name))[0];
    const past = new Set(events.filter(e => e.type === 'vote' && (e.winner === left.id || e.loser === left.id)).map(e => e.winner === left.id ? e.loser : e.winner));
    right = result.active.filter(cafe => cafe.id !== left.id).sort((a, b) => Number(past.has(a.id)) - Number(past.has(b.id)) || Math.abs((result.scores.get(a.id)?.rating || 1500) - (result.scores.get(left.id)?.rating || 1500)) - Math.abs((result.scores.get(b.id)?.rating || 1500) - (result.scores.get(left.id)?.rating || 1500)))[0];
  }
  if (!left || !right) return [];
  if (events.length % 2) [left, right] = [right, left];
  if (previous.length === 2 && [left.id, right.id].sort().join('|') === previous.slice().sort().join('|') && result.active.length > 2) {
    const alternate = fresh.find(cafe => cafe.id !== left.id && cafe.id !== right.id) || result.active.find(cafe => cafe.id !== left.id && cafe.id !== right.id);
    if (alternate) right = alternate;
  }
  return [left.id, right.id];
}
export function mergeCafes(current, incoming) {
  const result = current.slice(), byId = new Map(current.map(c => [c.id, c]));
  const byGoogle = new Map();
  current.forEach(c => (c.googleIds || []).forEach(id => byGoogle.set(id, c)));
  let added = 0;
  for (const cafe of incoming) {
    const existing = byId.get(cafe.id) || (cafe.googleIds || []).map(id => byGoogle.get(id)).find(Boolean);
    if (existing) continue;
    result.push(cafe); byId.set(cafe.id, cafe);
    (cafe.googleIds || []).forEach(id => byGoogle.set(id, cafe));
    added++;
  }
  return { cafes: result, added };
}
export function validateBackup(value) {
  if (!value || value.app !== 'cafe-index' || value.version !== 1 || !Array.isArray(value.events) || !Array.isArray(value.addedCafes)) throw new Error('Choose a Café Index backup file.');
  const allowed = new Set(['vote', 'exclude', 'restore']);
  if (value.events.length > 100000 || value.addedCafes.length > 10000) throw new Error('This backup is too large.');
  for (const event of value.events) {
    const validId = id => typeof id === 'string' && id.length > 0 && id.length < 200;
    if (!event || !allowed.has(event.type) || (event.type === 'vote' ? !validId(event.winner) || !validId(event.loser) : !validId(event.id))) throw new Error('This backup contains an invalid choice.');
  }
  for (const cafe of value.addedCafes) {
    if (!cafe || typeof cafe.id !== 'string' || cafe.id.length > 200 || !cafe.id || typeof cafe.name !== 'string' || !cafe.name || cafe.name.length > 200 || (cafe.googleIds !== undefined && (!Array.isArray(cafe.googleIds) || cafe.googleIds.some(id => typeof id !== 'string')))) throw new Error('This backup contains an invalid café.');
  }
  return { events: value.events, addedCafes: value.addedCafes };
}

// New imports are deliberately conservative: a named, place-identified coffee
// record must anchor a venue. Direction records can enrich it, never create it.
// A route's last place ID can describe its origin rather than its destination.
export function parseMapsActivity(records) {
  if (!Array.isArray(records)) throw new Error('Choose the Maps MyActivity.json export. Timeline exports use a different format.');
  const found = new Map();
  const coffee = /\b(coffee|café|cafe|caff[eèé]|roaster(?:s|y)?|espresso)\b/i;
  const generic = /^(coffee|coffee shops?|caf[eé]s?|coffee near me|coffee roasters?|espresso|cafe near me)$/i;
  const clean = text => text.replace(/^(Searched for |Viewed |Visited |Directions to )/i, '').trim();
  const norm = text => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const hash = text => { let n = 2166136261; for (const ch of text) n = Math.imul(n ^ ch.charCodeAt(0),16777619); return (n >>> 0).toString(16); };
  for (const record of records) {
    if (!record || typeof record.title !== 'string' || /^Directions to /i.test(record.title)) continue;
    let url; try { url = new URL(record.titleUrl); } catch { continue; }
    if (!/(^|\.)google\.[a-z.]+$/.test(url.hostname) || /\/maps\/dir\//.test(url.pathname)) continue;
    let decoded; try { decoded = decodeURIComponent(url.href.replace(/\+/g,' ')); } catch { continue; }
    const ids = decoded.match(/0x[0-9a-f]+:0x[0-9a-f]+/ig);
    if (!ids?.length) continue;
    const pid = ids[ids.length-1].toLowerCase(), query = url.searchParams.get('q') || '';
    const title = clean(record.title), name = title.split(',')[0].trim();
    if (!coffee.test(name) || generic.test(name) || name.length > 150 || name.length < 3) continue;
    const date = typeof record.time === 'string' ? record.time.slice(0,10) : '';
    let cafe = found.get(pid);
    if (!cafe) {
      const full = query.startsWith(name) && query.includes(',') ? query : title;
      const address = full.startsWith(`${name},`) ? full.slice(name.length+1).trim() : '';
      const parts = address.split(',').map(x => x.trim());
      const us = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(parts.at(-1) || '');
      const city = us && parts.length > 1 ? parts.at(-2) : '';
      cafe = { id: `import-${hash(pid)}`, name, address, city, country: us ? 'United States' : '', lastActivity: date, directions: 0, googleIds: [pid], mapsUrl: url.href, lat: null, lng: null, locationPrecision: 'unknown' };
      found.set(pid, cafe);
    }
    if (date > cafe.lastActivity) cafe.lastActivity = date;
    const point = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (point && Math.abs(Number(point[1])) <= 90 && Math.abs(Number(point[2])) <= 180) { cafe.lat = Number(point[1]); cafe.lng = Number(point[2]); cafe.locationPrecision = 'place'; }
  }
  for (const record of records) {
    if (!record || typeof record.title !== 'string' || !/^Directions to /i.test(record.title)) continue;
    let decoded; try { decoded = decodeURIComponent(record.titleUrl || ''); } catch { continue; }
    const ids = decoded.match(/0x[0-9a-f]+:0x[0-9a-f]+/ig) || [];
    const destination = norm(clean(record.title).split(',')[0]);
    for (const pid of ids) { const cafe = found.get(pid.toLowerCase()); if (cafe && destination === norm(cafe.name)) cafe.directions++; }
  }
  return [...found.values()];
}

