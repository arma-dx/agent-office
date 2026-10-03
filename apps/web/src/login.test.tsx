import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from './test/mock-api.ts';
import { renderApp } from './test/render-app.tsx';

describe('login screen', () => {
  it('offers Google sign-in as a plain link to the API, with the Google mark', async () => {
    const api = mockApi({});
    renderApp('/login');
    expect(await screen.findByRole('heading', { level: 1, name: 'Agent Office' })).toBeVisible();
    const link = screen.getByRole('link', { name: 'Google ile giriş yap' });
    expect(link).toHaveAttribute('href', '/api/auth/google');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // The login screen asks nothing of the API; the browser holds no keys.
    expect(api.calls).toEqual([]);
  });

  it('explains a denied sign-in and offers another account', async () => {
    mockApi({});
    renderApp('/login?status=denied');
    const alert = await screen.findByRole('alert');
    // "denied" also follows a cancelled Google screen or an expired sign-in, and invitations are
    // not emailed: the text neither claims a refusal nor mentions a sent invitation.
    expect(alert).toHaveTextContent(
      'Giriş tamamlanamadı. Davet edildiğiniz adresle girdiğinizden ve Google hesabınızda iki adımlı doğrulamanın açık olduğundan emin olup yeniden deneyin. Sorun sürerse sizi davet eden kişiye yazın.',
    );
    expect(alert).not.toHaveTextContent(/gönderildiği|izni yok/);
    expect(screen.getByRole('link', { name: 'Başka hesapla gir' })).toHaveAttribute(
      'href',
      '/api/auth/google',
    );
  });

  it('says when Google sign-in is unavailable', async () => {
    mockApi({});
    renderApp('/login?status=unavailable');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Google ile giriş şu an kullanılamıyor\./,
    );
    expect(screen.queryByRole('link', { name: 'Başka hesapla gir' })).not.toBeInTheDocument();
  });

  it('says the session closed and why', async () => {
    mockApi({});
    renderApp('/login?status=expired');
    expect(await screen.findByRole('status')).toHaveTextContent(/^Oturumunuz kapandı\./);
    expect(screen.getByRole('status')).toHaveTextContent(/30 dakika/);
  });

  it('confirms a sign-out', async () => {
    mockApi({});
    renderApp('/login?status=signed_out');
    expect(await screen.findByRole('status')).toHaveTextContent('Çıkış yaptınız.');
  });

  it('ignores an unknown status value', async () => {
    mockApi({});
    renderApp('/login?status=<script>');
    expect(await screen.findByRole('link', { name: 'Google ile giriş yap' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
