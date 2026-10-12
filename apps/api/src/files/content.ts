import type { ProjectFileType } from '@agent-office/shared';

/**
 * Says whether the bytes of an uploaded file are what its extension says (8 October decision 20:
 * the type is decided from the content and the name, against the fixed list). The browser's own
 * Content-Type is never read. Nothing here opens, renders or unpacks a file: only fixed positions
 * are compared, and for the three Office formats the list of names at the end of the zip is read.
 *
 * This is not a malware scan: a file of an allowed type can still be harmful to the program that
 * opens it. A scanner is installed on the server when the server is set up; until then files are
 * added unscanned (11 October decision 4; docs/SONRA.md P4-m).
 */

function startsWith(bytes: Buffer, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];
const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_END = 0x06054b50;
const ZIP_ENTRY = 0x02014b50;
// The end record is 22 bytes and may be followed by a comment of at most 65535.
const ZIP_END_MIN = 22;
const ZIP_END_SEARCH = ZIP_END_MIN + 0xffff;
const ZIP_MAX_ENTRIES = 20_000;

/**
 * The names of the entries of a zip file, from its central directory; null when the bytes are not
 * a plain zip (no end record, a zip64 or a split archive, a directory that does not add up).
 * Nothing is decompressed.
 */
export function zipEntryNames(bytes: Buffer): string[] | null {
  if (!startsWith(bytes, ZIP_LOCAL) || bytes.length < ZIP_END_MIN) return null;
  let end = -1;
  const lowest = Math.max(0, bytes.length - ZIP_END_SEARCH);
  for (let at = bytes.length - ZIP_END_MIN; at >= lowest; at -= 1) {
    if (bytes.readUInt32LE(at) === ZIP_END) {
      end = at;
      break;
    }
  }
  if (end === -1) return null;
  const disk = bytes.readUInt16LE(end + 4);
  const startDisk = bytes.readUInt16LE(end + 6);
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const offset = bytes.readUInt32LE(end + 16);
  if (disk !== 0 || startDisk !== 0) return null;
  // 0xffff and 0xffffffff mean "see the zip64 record": not a file of 25 MB that Office wrote.
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return null;
  if (count === 0 || count > ZIP_MAX_ENTRIES || offset + size > end) return null;
  const names: string[] = [];
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== ZIP_ENTRY) return null;
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    if (at + 46 + nameLength > end) return null;
    names.push(bytes.toString('utf8', at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// The folder that holds the main part of each Office format.
const OFFICE_FOLDER: Record<string, string> = { docx: 'word/', xlsx: 'xl/', pptx: 'ppt/' };

/**
 * An Office Open XML file of the given extension: a zip that lists [Content_Types].xml and a part
 * under the format's own folder, and no macro project (a macro-enabled document that was renamed
 * to .docx, .xlsx or .pptx is refused).
 */
function isOfficeFile(bytes: Buffer, extension: string): boolean {
  const folder = OFFICE_FOLDER[extension];
  const names = zipEntryNames(bytes);
  if (folder === undefined || names === null) return false;
  if (!names.includes('[Content_Types].xml')) return false;
  if (!names.some((name) => name.startsWith(folder))) return false;
  return !names.some((name) => name.toLowerCase().endsWith('vbaproject.bin'));
}

/**
 * Text as a person wrote it: no NUL and no control byte except tab, line feed, form feed and
 * carriage return. The encoding is not judged (a CSV that Excel saved in Windows-1254 is text
 * too); a file of any other kind fails on its first control bytes.
 */
function isText(bytes: Buffer): boolean {
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) {
      return false;
    }
    if (byte === 0x7f) return false;
  }
  return true;
}

/** Whether the bytes are a file of this type. An empty file is no type. */
export function contentMatches(bytes: Buffer, type: ProjectFileType): boolean {
  if (bytes.length === 0) return false;
  switch (type.extension) {
    case 'pdf':
      return startsWith(bytes, PDF);
    case 'png':
      return startsWith(bytes, PNG);
    case 'jpg':
    case 'jpeg':
      return startsWith(bytes, JPEG);
    case 'gif':
      return startsWith(bytes, GIF87) || startsWith(bytes, GIF89);
    case 'webp':
      return startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8);
    case 'docx':
    case 'xlsx':
    case 'pptx':
      return isOfficeFile(bytes, type.extension);
    case 'csv':
    case 'txt':
    case 'md':
      return isText(bytes);
    default:
      return false;
  }
}
