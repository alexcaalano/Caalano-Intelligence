// Swaps @netlify/blobs for an in-memory store, so backup and cache code can be
// exercised without Netlify. Used with: node --import tests/fixtures/register-fake-blobs.mjs
import { register } from 'node:module'
register('./fake-blobs-hook.mjs', import.meta.url)
