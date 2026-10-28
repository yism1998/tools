import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/coi-serviceworker.js', import.meta.url), 'utf8');
const origin = 'https://example.test';

function worker(fetch) {
  const listeners = new Map();
  runInNewContext(source, {
    self: { location: { origin, href: `${origin}/tools/coi-serviceworker.js` }, addEventListener: (name, handler) => listeners.set(name, handler) },
    fetch, URL, Request, Response, Headers, console,
  });
  return {
    fetch(request) {
      let response;
      listeners.get('fetch')({ request, respondWith: value => { response = value; } });
      return response;
    },
    credentialless() {
      listeners.get('message')({ data: { type: 'coepCredentialless', value: true } });
    },
  };
}

test('telemetry POST and cross-origin GET bypass the Service Worker', () => {
  const sw = worker(() => assert.fail('Bypassed requests must not call the worker fetch'));
  for (const request of [
    new Request('https://cloudflareinsights.com/cdn-cgi/rum', { method: 'POST', body: '{}' }),
    new Request('https://static.cloudflareinsights.com/beacon.min.js'),
    new Request(`${origin}/telemetry`, { method: 'POST', body: '{}' }),
  ]) assert.equal(sw.fetch(request), undefined);
});

test('same-origin document, model and WASM retain headers, body and status', async () => {
  for (const path of ['/tools/', '/tools/models/lama_fp32.onnx', '/tools/ort/runtime.wasm']) {
    const request = new Request(`${origin}${path}`);
    const sw = worker(async received => {
      assert.equal(received, request);
      return new Response('body', { status: 206, headers: { 'content-type': 'application/octet-stream' } });
    });
    const response = await sw.fetch(request);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(await response.text(), 'body');
  }
});

test('credentialless mode still omits no-cors credentials and sets COEP', async () => {
  const sw = worker(async request => {
    assert.equal(request.credentials, 'omit');
    return new Response('body');
  });
  sw.credentialless();
  const response = await sw.fetch(new Request(`${origin}/tools/image.jpg`, { mode: 'no-cors' }));
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'credentialless');
});

test('network failures reject respondWith rather than resolving to undefined', async () => {
  const error = new TypeError('Network unavailable');
  const sw = worker(async () => { throw error; });
  await assert.rejects(sw.fetch(new Request(`${origin}/tools/`)), err => err === error);
});

test('status 0 responses pass through without being reconstructed', async () => {
  const error = Response.error();
  const sw = worker(async () => error);
  assert.equal(await sw.fetch(new Request(`${origin}/tools/`)), error);
});
