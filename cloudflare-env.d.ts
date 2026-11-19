declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    CAFE_OWNER_EMAIL?: string;
    BUCKET?: R2Bucket;
  }
}
