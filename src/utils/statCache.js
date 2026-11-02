const MAX_ENTRIES = 128;
const MAX_BYTES = 8 * 1024 * 1024;
const cache = new Map();
let bytes = 0;
function keyFor(userId, profileId, revision, type, variation = '') {
  return JSON.stringify([Number(userId), Number(profileId), Number(revision), type, variation]);
}
function peek(userId, profileId, revision, type, variation) {
  const key = keyFor(userId, profileId, revision, type, variation), hit = cache.get(key);
  if (!hit) return { found: false };
  if (hit.expires <= Date.now()) { cache.delete(key); bytes -= hit.size; return { found: false }; }
  cache.delete(key); cache.set(key, hit);
  return { found: true, value: hit.value };
}
async function memo(userId, profileId, revision, type, variation, ttl, loader) {
  const key = keyFor(userId, profileId, revision, type, variation);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) { cache.delete(key); cache.set(key, hit); return hit.value; }
  if (hit) { cache.delete(key); bytes -= hit.size; }
  const value = await loader();
  const size = Buffer.byteLength(JSON.stringify(value));
  if (size <= MAX_BYTES) {
    const previous = cache.get(key);
    if (previous) { cache.delete(key); bytes -= previous.size; }
    while (cache.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) {
      const oldest = cache.keys().next().value;
      bytes -= cache.get(oldest).size; cache.delete(oldest);
    }
    cache.set(key, { value, size, expires: Date.now() + ttl }); bytes += size;
  }
  return value;
}
function invalidate(userId, profileId) {
  for (const [key, entry] of cache) {
    const [owner, profile] = JSON.parse(key);
    if (owner === Number(userId) && profile === Number(profileId)) { cache.delete(key); bytes -= entry.size; }
  }
}
module.exports = { memo, peek, invalidate };
