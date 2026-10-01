import { describe, expect, it } from 'vitest';

// vitest 5.0.2 ile jsdom 30.1.1 birlikte kullanılınca Blob gövdeli istekler bozuluyor.
// Bu yüzden ikisi birlikte yükseltilir; bu test yanlış eşleşmeyi yakalar.
describe('test ortamı', () => {
  it('jsdom Blob ve Request gövdesini destekler', async () => {
    const req = new Request('http://localhost/api/x', { method: 'POST', body: new Blob(['abc']) });
    expect(await req.text()).toBe('abc');
  });
});
