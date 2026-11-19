import { env } from 'cloudflare:workers';
import { stateEndpoint } from '../../../server/state.js';
import source from '../../../data/cafes.json';
export const dynamic = 'force-dynamic';
export function GET(request:Request) { return stateEndpoint(request,env.DB,source.cafes,env.CAFE_OWNER_EMAIL); }
export function PUT(request:Request) { return stateEndpoint(request,env.DB,source.cafes,env.CAFE_OWNER_EMAIL); }
