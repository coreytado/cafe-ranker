import page from '../page.html?raw';
export const dynamic = 'force-dynamic';
export function GET() {
  return new Response(page, {headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'}});
}
