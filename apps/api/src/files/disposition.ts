/**
 * The Content-Disposition of a download: always "attachment", so that the browser saves the file
 * and never shows it as a page. The name is given twice (RFC 6266): a plain ASCII form for old
 * clients, in which every other character is "_", and the real name percent-encoded (RFC 5987).
 * Neither form can hold a quote, a backslash, a line break or a separator.
 */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
