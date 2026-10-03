import { describe, expect, it } from 'vitest';

// With vitest 5.0.2 and jsdom 30.1.1 together, requests with a Blob body break.
// So the two are upgraded together; this test catches a wrong pairing.
describe('test environment', () => {
  it('jsdom supports Blob and Request bodies', async () => {
    const req = new Request('http://localhost/api/x', { method: 'POST', body: new Blob(['abc']) });
    expect(await req.text()).toBe('abc');
  });
});
