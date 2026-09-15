// The result-cache schema, shared by the server (cache key prefix) and the
// app (which payloads it may keep between visits). Bump it in the same commit
// as any change to what a cached number means or a field the UI depends on:
// every payload built by the previous code is then left behind, on the
// server and in the browser, and shows the new meaning on the next load.
// A release that leaves the numbers alone keeps the constant, so remembered
// payloads still paint instantly.
export const RESULT_CACHE_SCHEMA = 7
