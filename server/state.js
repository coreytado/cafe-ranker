import { computeRanking, mergeCafes, validateBackup } from '../public/model.js';
const KEY = 'coreys-cafe-index';
const empty = () => ({events:[],addedCafes:[]});
const json = (value,status=200) => Response.json(value,{status,headers:{'cache-control':'no-store','vary':'Cookie','x-robots-tag':'noindex, nofollow'}});
export function ownerIdentity(request, ownerEmail) {
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return id && email && ownerEmail && email.toLowerCase() === ownerEmail.toLowerCase() ? id : null;
}
async function read(db) {
  const row = await db.prepare('SELECT owner_id, payload, revision FROM collections WHERE id = ?').bind(KEY).first();
  return {ownerId:row?.owner_id ?? null, state:row ? JSON.parse(row.payload) : empty(), revision:row?.revision ?? 0};
}
function publicView(base,state) {
  const cafes = mergeCafes(base,state.addedCafes).cafes;
  const result = computeRanking(cafes,state.events);
  const rankedIds = new Set(result.ranked.map(s=>s.id));
  // Expose only ranked branches, never the candidate list or activity history.
  const fields = ['id','name','city','country','address','lat','lng','locationPrecision','photo','photoSource','photoCredit'];
  return {canEdit:false,ranking:result.ranked,cafes:cafes.filter(c=>rankedIds.has(c.id)).map(c=>Object.fromEntries(fields.map(k=>[k,c[k]??null])))};
}
export async function stateEndpoint(request,db,base,ownerEmail) {
  try {
    if (!db) return json({error:'Central storage is unavailable. Please try again.'},503);
    const current = await read(db), identity = ownerIdentity(request,ownerEmail);
    const canEdit = Boolean(identity && (!current.ownerId || current.ownerId === identity));
    if (request.method === 'GET') return json(canEdit ? {canEdit:true,state:current.state,revision:current.revision} : publicView(base,current.state));
    if (request.method !== 'PUT') return json({error:'Method not allowed.'},405);
    if (!canEdit) return json({error:'Only Corey can edit this ranking. Sign in with the owner account.'},403);
    if (request.headers.get('origin') !== new URL(request.url).origin) return json({error:'Save from the Café Index page.'},403);
    const text = await request.text();
    if (text.length > 5000000) return json({error:'This collection is too large to save.'},413);
    let body, next;
    try { body = JSON.parse(text); next = validateBackup(body); } catch(error) { return json({error:error.message || 'Invalid collection.'},400); }
    if (!Number.isSafeInteger(body.revision) || body.revision !== current.revision) return json({error:'The collection changed on another device.',state:current.state,revision:current.revision},409);
    const result = await db.prepare(`INSERT INTO collections (id,owner_id,payload,revision,updated_at)
      VALUES (?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,
      revision=collections.revision+1, updated_at=excluded.updated_at
      WHERE collections.revision=? AND collections.owner_id=? RETURNING revision`)
      .bind(KEY,identity,JSON.stringify(next),new Date().toISOString(),body.revision,identity).first();
    if (!result) { const latest=await read(db); return json({error:'The collection changed on another device.',state:latest.state,revision:latest.revision},409); }
    return json({canEdit:true,state:next,revision:result.revision});
  } catch { return json({error:'Could not reach central storage. Your choice has not been confirmed saved.'},503); }
}
