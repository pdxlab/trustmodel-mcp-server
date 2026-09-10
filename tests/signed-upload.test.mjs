import assert from "node:assert/strict";
import test from "node:test";

import { putToSignedUrl } from "../dist/client.js";

test("signed trace uploads declare an Azure BlockBlob", async () => {
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(null, { status: 201 });
  };

  try {
    await putToSignedUrl(
      "https://example.blob.core.windows.net/traces/trace.json?sig=redacted",
      '{"trace_id":"trace-test"}',
      "application/json"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    request.url,
    "https://example.blob.core.windows.net/traces/trace.json?sig=redacted"
  );
  assert.equal(request.init.method, "PUT");
  assert.equal(request.init.body, '{"trace_id":"trace-test"}');
  assert.deepEqual(request.init.headers, {
    "Content-Type": "application/json",
    "x-ms-blob-type": "BlockBlob",
  });
});
