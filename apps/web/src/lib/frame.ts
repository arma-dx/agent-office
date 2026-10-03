/**
 * Is the panel open inside a frame of another page? A page on a sibling subdomain (same site, so
 * the session cookie goes along) could frame the panel and lay its own page over the confirm
 * buttons of the passkey dialogs. The web server forbids framing (frame-ancestors 'none'); the
 * panel also refuses to start in a frame, in case a server misses the header.
 */
export function isFramed(view: Pick<Window, 'self' | 'top'>): boolean {
  return view.top !== view.self;
}

export const FRAMED_TEXT =
  'Agent Office başka bir sayfanın içinde açılamaz. Paneli kendi adresinden açın.';
