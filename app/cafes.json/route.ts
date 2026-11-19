import {env} from 'cloudflare:workers';
import source from '../../data/cafes.json';
import {ownerIdentity} from '../../server/state.js';
export const dynamic = 'force-dynamic';
export function GET(request:Request) {
  return ownerIdentity(request,env.CAFE_OWNER_EMAIL)
    ? Response.json(source,{headers:{'cache-control':'no-store','vary':'Cookie'}})
    : Response.json({error:'Private collection.'},{status:403,headers:{'cache-control':'no-store'}});
}
