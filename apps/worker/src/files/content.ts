import { agentFileForm } from '@agent-office/shared';
import type { FileBlock } from '../model/client.ts';

export type TextEncoding = 'utf-8' | 'windows-1254';

/**
 * UTF-8 (a byte order mark is dropped) when the bytes are valid UTF-8; otherwise Windows-1254,
 * which decodes every byte (a CSV that Excel saved on a Turkish Windows; docs/SONRA.md P6-j).
 * Nothing else of a file is ever opened by the worker.
 */
export function decodeText(bytes: Buffer): { text: string; encoding: TextEncoding } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1254').decode(bytes), encoding: 'windows-1254' };
  }
}

type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

function isImageType(mimeType: string): mimeType is ImageType {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType);
}

/**
 * The block a file is given to the model in; null for a type agents do not read.
 *   pdf    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
 *   image  { type: 'image', source: { type: 'base64', media_type: <the stored type>, data } }
 *   text   { type: 'document', source: { type: 'text', media_type: 'text/plain', data: <decoded> } }
 * No title, no context, no citations: nothing but the content.
 */
export function fileBlock(
  mimeType: string,
  bytes: Buffer,
): { block: FileBlock; encoding: TextEncoding | null } | null {
  const form = agentFileForm(mimeType);
  if (form === 'pdf') {
    return {
      block: {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') },
      },
      encoding: null,
    };
  }
  if (form === 'image' && isImageType(mimeType)) {
    return {
      block: {
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: bytes.toString('base64') },
      },
      encoding: null,
    };
  }
  if (form === 'text') {
    const { text, encoding } = decodeText(bytes);
    return {
      block: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text } },
      encoding,
    };
  }
  return null;
}
