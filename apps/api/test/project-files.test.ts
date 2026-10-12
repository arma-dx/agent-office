import { createHash, randomUUID } from 'node:crypto';
import { connect, type AddressInfo } from 'node:net';
import {
  COMPANY_HEADER,
  FILE_NAME_HEADER,
  PROJECT_FILE_MAX_BYTES,
  UPLOAD_TICKET_HEADER,
  UPLOAD_TICKET_SECONDS,
  projectDetailSchema,
  projectFileListSchema,
  projectFileSchema,
  uploadTicketSchema,
  type ProjectFile,
} from '@agent-office/shared';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryFileStorage } from '../src/files/storage.ts';
import { UploadTickets } from '../src/files/ticket.ts';
import { hashSessionKey } from '../src/session.ts';
import { SAMPLES } from './file-samples.ts';
import { accounts, ids } from './fixtures.ts';
import {
  PANEL_ORIGIN,
  SAME_ORIGIN,
  SESSION_COOKIE,
  adminExec,
  adminQuery,
  closeAdminPool,
  createTestServer,
  noDatabase,
  sessionOf,
  type TestServer,
} from './helpers.ts';
import { errorCode, send, type Method } from './passkey-helpers.ts';

// Project files through the API (8 October decision 20): who lists, adds, opens and deletes; the
// type, the name and the size; what lies in the storage and under which key; what happens when
// the storage fails. The storage is the tests' own, in memory.

describe.skipIf(noDatabase)('project files', () => {
  let server: TestServer;
  let founder: string;
  let employee: string;
  let colleague: string;
  let outsider: string;
  let external: string;
  // A project the employee opened (its owner); the colleague is a plain member, the outsider is
  // not a member.
  let project: string;

  const call = (session: string, method: Method, url: string, company: string = ids.arma) =>
    send(server, session, method, url, { company });

  const put = (
    session: string,
    name: string,
    content: Buffer,
    options: UploadOptions,
    ticket: string | null,
  ): Promise<LightMyRequestResponse> =>
    (options.server ?? server).app.inject({
      method: 'PUT',
      url: `/api/projects/${options.project ?? project}/files/${options.id ?? randomUUID()}`,
      cookies: { [SESSION_COOKIE]: session },
      headers: {
        ...SAME_ORIGIN,
        [COMPANY_HEADER]: options.company ?? ids.arma,
        'content-type': 'application/octet-stream',
        [FILE_NAME_HEADER]: encodeURIComponent(name),
        ...(ticket !== null ? { [UPLOAD_TICKET_HEADER]: ticket } : {}),
        ...options.headers,
      },
      payload: content,
    });

  interface UploadOptions {
    project?: string;
    id?: string;
    company?: string;
    headers?: Record<string, string>;
    server?: TestServer;
  }

  const askTicket = (
    session: string,
    sizeBytes: number,
    options: UploadOptions & { id: string },
  ): Promise<LightMyRequestResponse> =>
    send(
      options.server ?? server,
      session,
      'POST',
      `/api/projects/${options.project ?? project}/files/${options.id}/ticket`,
      { company: options.company ?? ids.arma, payload: { sizeBytes } },
    );

  /**
   * Sends a file as the panel does: the ticket first, for the length the upload will declare, then
   * the bytes with it. A refused ticket is the answer (nothing is sent after it). A declared
   * length that is no number gets no ticket and is sent as it is.
   */
  async function upload(
    session: string,
    name: string,
    content: Buffer,
    options: UploadOptions = {},
  ): Promise<LightMyRequestResponse> {
    const id = options.id ?? randomUUID();
    const declared = Number(options.headers?.['content-length'] ?? content.length);
    if (!Number.isInteger(declared)) {
      return put(session, name, content, { ...options, id }, null);
    }
    const asked = await askTicket(session, declared, { ...options, id });
    if (asked.statusCode !== 200) {
      return asked;
    }
    return put(
      session,
      name,
      content,
      { ...options, id },
      uploadTicketSchema.parse(asked.json()).ticket,
    );
  }

  /** A ticket as the server would sign it, for a session that was never given one. */
  function forged(
    session: string,
    claim: { id: string; sizeBytes: number; project?: string; company?: string },
    now: () => number = Date.now,
  ): string {
    const sessionKeyHash = hashSessionKey(session);
    if (!sessionKeyHash) throw new Error('Not a session key');
    return new UploadTickets(server.config.cookieSecret, now).issue({
      sessionKeyHash,
      companyId: claim.company ?? ids.arma,
      projectId: claim.project ?? project,
      fileId: claim.id,
      sizeBytes: claim.sizeBytes,
    }).ticket;
  }

  async function added(session: string, name: string, content: Buffer): Promise<ProjectFile> {
    const res = await upload(session, name, content);
    expect(res.statusCode, res.body).toBe(201);
    return projectFileSchema.parse(res.json());
  }

  async function list(session: string, projectId: string = project) {
    const res = await call(session, 'GET', `/api/projects/${projectId}/files`);
    expect(res.statusCode, res.body).toBe(200);
    return projectFileListSchema.parse(res.json());
  }

  const keyOf = (fileId: string, projectId: string = project) =>
    `${ids.arma}/projects/${projectId}/${fileId}`;

  beforeAll(async () => {
    server = createTestServer();
    founder = await sessionOf(server, accounts.founder);
    employee = await sessionOf(server, accounts.employee);
    colleague = await sessionOf(server, accounts.holder);
    outsider = await sessionOf(server, accounts.newcomer);
    external = await sessionOf(server, accounts.external);
    const res = await send(server, employee, 'POST', '/api/projects', {
      company: ids.arma,
      payload: { id: randomUUID(), name: 'Dosya projesi', memberIds: [ids.holder] },
    });
    expect(res.statusCode, res.body).toBe(201);
    project = projectDetailSchema.parse(res.json()).id;
  });

  beforeEach(() => {
    server.storage.failing.clear();
    server.storage.calls.length = 0;
  });

  afterAll(async () => {
    await server.close();
    await closeAdminPool();
  });

  it('a member adds a file; the record, the bytes, the key and the trace are written', async () => {
    const id = randomUUID();
    const res = await upload(employee, 'Şartname (son).pdf', SAMPLES.pdf, { id });
    expect(res.statusCode, res.body).toBe(201);
    const file = projectFileSchema.parse(res.json());
    expect(file).toMatchObject({
      id,
      name: 'Şartname (son).pdf',
      kind: 'pdf',
      sizeBytes: SAMPLES.pdf.length,
      createdBy: { userId: ids.employee, name: 'Çalışan' },
      deletable: true,
    });
    const [row] = await adminQuery(
      'select kind, mime_type, sha256, storage_path, created_by_user_id from office.files where id = $1',
      [id],
    );
    expect(row).toEqual({
      kind: 'project_file',
      mime_type: 'application/pdf',
      sha256: createHash('sha256').update(SAMPLES.pdf).digest('hex'),
      storage_path: keyOf(id),
      created_by_user_id: ids.employee,
    });
    expect(server.storage.objects.get(keyOf(id))?.content.equals(SAMPLES.pdf)).toBe(true);
    const trace = await adminQuery(
      `select event, user_id, project_id, record_type from office.audit_log where record_id = $1`,
      [id],
    );
    expect(trace).toEqual([
      {
        event: 'project_file_added',
        user_id: ids.employee,
        project_id: project,
        record_type: 'file',
      },
    ]);
  });

  it('every type of the list is taken, and the list says its kind', async () => {
    const cases: [string, Buffer, string][] = [
      ['a.docx', SAMPLES.docx, 'document'],
      ['a.xlsx', SAMPLES.xlsx, 'spreadsheet'],
      ['a.csv', SAMPLES.csv1254, 'spreadsheet'],
      ['a.pptx', SAMPLES.pptx, 'presentation'],
      ['a.PNG', SAMPLES.png, 'image'],
      ['a.jpeg', SAMPLES.jpeg, 'image'],
      ['a.gif', SAMPLES.gif, 'image'],
      ['a.webp', SAMPLES.webp, 'image'],
      ['a.txt', SAMPLES.text, 'text'],
      ['a.md', SAMPLES.text, 'text'],
    ];
    for (const [name, bytes, kind] of cases) {
      expect((await added(colleague, name, bytes)).kind, name).toBe(kind);
    }
  });

  it('who lists: the founder and the members; nobody else learns that the project exists', async () => {
    const file = await added(employee, 'liste.txt', SAMPLES.text);
    for (const session of [founder, employee, colleague]) {
      const answer = await list(session);
      expect(answer.storageAvailable).toBe(true);
      expect(answer.files.map((entry) => entry.id)).toContain(file.id);
    }
    // Deletable: the person who added it (here also the owner) and the founder; not a plain member.
    const of = async (session: string) =>
      (await list(session)).files.find((entry) => entry.id === file.id);
    expect((await of(employee))?.deletable).toBe(true);
    expect((await of(founder))?.deletable).toBe(true);
    expect((await of(colleague))?.deletable).toBe(false);
    const url = `/api/projects/${project}/files`;
    expect((await call(outsider, 'GET', url)).statusCode).toBe(404);
    expect(errorCode(await call(external, 'GET', url))).toBe('insiders_only');
    // The founder in Pillika's context: the Arma DX project does not exist there.
    expect((await call(founder, 'GET', url, ids.pillika)).statusCode).toBe(404);
    expect((await call(founder, 'GET', `/api/projects/not-a-uuid/files`)).statusCode).toBe(404);
  });

  it('who adds: nobody but the founder and the members, and nothing reaches the storage', async () => {
    const tries: [string, Promise<LightMyRequestResponse>][] = [
      ['outsider', upload(outsider, 'x.txt', SAMPLES.text)],
      ['external', upload(external, 'x.txt', SAMPLES.text)],
      [
        'founder, Pillika context',
        upload(founder, 'x.txt', SAMPLES.text, { company: ids.pillika }),
      ],
      [
        'employee, a project that is not there',
        upload(employee, 'x.txt', SAMPLES.text, { project: randomUUID() }),
      ],
    ];
    const codes: Record<string, number> = {};
    for (const [who, pending] of tries) codes[who] = (await pending).statusCode;
    expect(codes).toEqual({
      outsider: 404,
      external: 403,
      'founder, Pillika context': 404,
      'employee, a project that is not there': 404,
    });
    expect(server.storage.calls).toEqual([]);
    // The founder, no member of the project, adds.
    expect((await added(founder, 'kurucu.txt', SAMPLES.text)).createdBy?.userId).toBe(ids.founder);
  });

  it('refuses what is not a file of the list, by name and by content', async () => {
    const tries: [string, Buffer, number, string][] = [
      ['sayfa.html', SAMPLES.html, 415, 'file_type_not_allowed'],
      ['çizim.svg', SAMPLES.svg, 415, 'file_type_not_allowed'],
      ['kur.exe', SAMPLES.exe, 415, 'file_type_not_allowed'],
      ['arşiv.zip', SAMPLES.zip, 415, 'file_type_not_allowed'],
      ['eski.doc', SAMPLES.text, 415, 'file_type_not_allowed'],
      ['adsız', SAMPLES.text, 415, 'file_type_not_allowed'],
      ['.pdf', SAMPLES.pdf, 415, 'file_type_not_allowed'],
      ['rapor.pdf.exe', SAMPLES.pdf, 415, 'file_type_not_allowed'],
      // The name says one type, the bytes are another.
      ['sayfa.pdf', SAMPLES.html, 415, 'file_content_mismatch'],
      ['resim.png', SAMPLES.exe, 415, 'file_content_mismatch'],
      ['belge.docx', SAMPLES.zip, 415, 'file_content_mismatch'],
      ['makro.docx', SAMPLES.docm, 415, 'file_content_mismatch'],
      ['tablo.xlsx', SAMPLES.docx, 415, 'file_content_mismatch'],
      ['not.txt', SAMPLES.png, 415, 'file_content_mismatch'],
    ];
    for (const [name, bytes, status, code] of tries) {
      const res = await upload(employee, name, bytes);
      expect(res.statusCode, name).toBe(status);
      expect(errorCode(res), name).toBe(code);
    }
    expect(server.storage.calls).toEqual([]);
  });

  it('a name cannot leave its folder: it is never part of the key, and odd names are refused', async () => {
    const raw = (value: string) =>
      upload(employee, 'x.txt', SAMPLES.text, { headers: { [FILE_NAME_HEADER]: value } });
    const refused: [string, Promise<LightMyRequestResponse>][] = [
      ['slash', upload(employee, '../../x.txt', SAMPLES.text)],
      ['backslash', upload(employee, '..\\x.txt', SAMPLES.text)],
      ['encoded slash', raw('..%2F..%2Fx.txt')],
      ['line break', raw('a%0d%0ab.txt')],
      ['nul', raw('a%00.txt')],
      ['bidi override', upload(employee, 'a‮txt.exe.txt', SAMPLES.text)],
      ['201 characters', upload(employee, `${'a'.repeat(197)}.txt`, SAMPLES.text)],
      ['broken encoding', raw('%E0%A4%A')],
      ['only spaces', raw('%20%20')],
    ];
    for (const [what, pending] of refused) {
      const res = await pending;
      expect(res.statusCode, what).toBe(400);
      expect(errorCode(res), what).toBe('file_name_invalid');
    }
    const missingId = randomUUID();
    const missing = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project}/files/${missingId}`,
      cookies: { [SESSION_COOKIE]: employee },
      headers: {
        ...SAME_ORIGIN,
        [COMPANY_HEADER]: ids.arma,
        'content-type': 'application/octet-stream',
        [UPLOAD_TICKET_HEADER]: forged(employee, {
          id: missingId,
          sizeBytes: SAMPLES.text.length,
        }),
      },
      payload: SAMPLES.text,
    });
    expect(errorCode(missing)).toBe('file_name_invalid');
    expect(server.storage.calls).toEqual([]);
    // A name with dots, spaces, a quote and Turkish letters is only a label; the key is three ids.
    const file = await added(employee, `  Teklif "v2" .. son.TXT `, SAMPLES.text);
    expect(file.name).toBe(`Teklif "v2" .. son.TXT`);
    expect([...server.storage.objects.keys()]).toContain(keyOf(file.id));
    for (const key of server.storage.objects.keys()) {
      expect(key).toMatch(/^[0-9a-f-]{36}\/projects\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    }
    // A decomposed name (as macOS can send it) is stored composed.
    const composed = await added(employee, 'Şartname.txt', SAMPLES.text);
    expect(composed.name).toBe('Şartname.txt');
  });

  it('the size limit: 25 MB is taken, one byte more is not, and a false length is not believed', async () => {
    const big = Buffer.alloc(PROJECT_FILE_MAX_BYTES, 0x61);
    const res = await upload(employee, 'tam.txt', big);
    expect(res.statusCode, res.body).toBe(201);
    const over = await upload(
      employee,
      'fazla.txt',
      Buffer.alloc(PROJECT_FILE_MAX_BYTES + 1, 0x61),
    );
    expect(over.statusCode).toBe(413);
    expect(errorCode(over)).toBe('file_too_large');
    const empty = await upload(employee, 'bos.txt', Buffer.alloc(0));
    expect(errorCode(empty)).toBe('file_empty');
    // A declared length that lies: the bytes are counted while they arrive.
    const lyingSmall = await upload(
      employee,
      'yalan.txt',
      Buffer.alloc(PROJECT_FILE_MAX_BYTES + 1, 0x61),
      {
        headers: { 'content-length': '10' },
      },
    );
    expect(lyingSmall.statusCode).toBe(413);
    expect(errorCode(lyingSmall)).toBe('file_too_large');
    const lyingShort = await upload(employee, 'yalan.txt', Buffer.from('on iki bayt.'), {
      headers: { 'content-length': '5' },
    });
    expect(lyingShort.statusCode).toBe(400);
    expect(errorCode(lyingShort)).toBe('invalid_request');
    const noLength = await upload(employee, 'yalan.txt', SAMPLES.text, {
      headers: { 'content-length': 'abc' },
    });
    expect(noLength.statusCode).toBe(400);
    const puts = server.storage.calls.filter((entry) => entry.operation === 'put');
    expect(puts).toHaveLength(1);
    await adminQuery(`delete from office.files where id = $1`, [
      projectFileSchema.parse(res.json()).id,
    ]);
  });

  it('a body that is not raw bytes, and a request without a session, are refused before the body', async () => {
    const json = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project}/files/${randomUUID()}`,
      cookies: { [SESSION_COOKIE]: employee },
      headers: { ...SAME_ORIGIN, [COMPANY_HEADER]: ids.arma, [FILE_NAME_HEADER]: 'x.txt' },
      payload: { a: 1 },
    });
    expect(json.statusCode).toBe(400);
    expect(json.headers.connection).toBe('close');
    const anonymous = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project}/files/${randomUUID()}`,
      headers: {
        ...SAME_ORIGIN,
        'content-type': 'application/octet-stream',
        [FILE_NAME_HEADER]: 'x.txt',
      },
      payload: SAMPLES.text,
    });
    expect(anonymous.statusCode).toBe(401);
    const crossSite = await server.app.inject({
      method: 'PUT',
      url: `/api/projects/${project}/files/${randomUUID()}`,
      cookies: { [SESSION_COOKIE]: employee },
      headers: {
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/octet-stream',
        [FILE_NAME_HEADER]: 'x.txt',
      },
      payload: SAMPLES.text,
    });
    expect(errorCode(crossSite)).toBe('cross_site_request');
    expect(server.storage.calls).toEqual([]);
  });

  it('a send that is repeated answers the first record; another file under the same id is refused', async () => {
    const id = randomUUID();
    const first = await upload(employee, 'tekrar.txt', SAMPLES.text, { id });
    expect(first.statusCode).toBe(201);
    const second = await upload(employee, 'tekrar.txt', SAMPLES.text, { id });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(server.storage.calls.filter((entry) => entry.operation === 'put')).toHaveLength(1);
    expect((await upload(employee, 'tekrar.txt', Buffer.from('başka'), { id })).statusCode).toBe(
      400,
    );
    expect((await upload(colleague, 'tekrar.txt', SAMPLES.text, { id })).statusCode).toBe(400);
    // An id that is a file of another project: nothing is said about it.
    const other = await send(server, founder, 'POST', '/api/projects', {
      company: ids.arma,
      payload: { id: randomUUID(), name: 'Öbür proje' },
    });
    const otherId = projectDetailSchema.parse(other.json()).id;
    const taken = await upload(founder, 'tekrar.txt', SAMPLES.text, { id, project: otherId });
    expect(taken.statusCode).toBe(400);
    expect(errorCode(taken)).toBe('invalid_request');
    const [{ n } = { n: -1 }] = await adminQuery<{ n: number }>(
      'select count(*)::int as n from office.files where id = $1',
      [id],
    );
    expect(n).toBe(1);
  });

  it('the download is an attachment a browser will not run, and only for who reads the project', async () => {
    const file = await added(employee, 'Şartname.pdf', SAMPLES.pdf);
    const url = `/api/projects/${project}/files/${file.id}/content`;
    const res = await call(colleague, 'GET', url);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.equals(SAMPLES.pdf)).toBe(true);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="_artname.pdf"; filename*=UTF-8''%C5%9Eartname.pdf`,
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-length']).toBe(String(SAMPLES.pdf.length));
    expect((await call(founder, 'GET', url)).statusCode).toBe(200);
    expect((await call(outsider, 'GET', url)).statusCode).toBe(404);
    expect((await call(external, 'GET', url)).statusCode).toBe(403);
    expect((await call(founder, 'GET', url, ids.pillika)).statusCode).toBe(404);
    // The file through another project of the same company the person reads.
    const other = await send(server, employee, 'POST', '/api/projects', {
      company: ids.arma,
      payload: { id: randomUUID(), name: 'Yan proje' },
    });
    const otherId = projectDetailSchema.parse(other.json()).id;
    expect(
      (await call(employee, 'GET', `/api/projects/${otherId}/files/${file.id}/content`)).statusCode,
    ).toBe(404);
    expect(
      (
        await send(server, employee, 'DELETE', `/api/projects/${otherId}/files/${file.id}`, {
          company: ids.arma,
        })
      ).statusCode,
    ).toBe(404);
    // No HEAD route asks the storage.
    const head = await server.app.inject({
      method: 'HEAD',
      url,
      cookies: { [SESSION_COOKIE]: employee },
      headers: { [COMPANY_HEADER]: ids.arma },
    });
    expect(head.statusCode).toBe(404);
  });

  it('bytes that are not the ones that were added are never given out', async () => {
    const file = await added(employee, 'bozuk.txt', SAMPLES.text);
    const url = `/api/projects/${project}/files/${file.id}/content`;
    const stored = server.storage.objects.get(keyOf(file.id));
    if (!stored) throw new Error('no object');
    server.storage.objects.set(keyOf(file.id), { ...stored, content: Buffer.from('<script>') });
    const changed = await call(employee, 'GET', url);
    expect(changed.statusCode).toBe(502);
    expect(errorCode(changed)).toBe('file_storage_failed');
    server.storage.objects.delete(keyOf(file.id));
    const gone = await call(employee, 'GET', url);
    expect(gone.statusCode).toBe(404);
    expect(errorCode(gone)).toBe('file_content_missing');
    server.storage.failing.add('get');
    expect(errorCode(await call(employee, 'GET', url))).toBe('file_storage_failed');
  });

  it('who deletes: who added the file, the owner, a manager and the founder; the bytes go with the record', async () => {
    const file = await added(employee, 'silinecek.txt', SAMPLES.text);
    const url = `/api/projects/${project}/files/${file.id}`;
    // A plain member does not delete a file somebody else added.
    const byColleague = await call(colleague, 'DELETE', url);
    expect(byColleague.statusCode).toBe(403);
    expect(errorCode(byColleague)).toBe('file_delete_not_allowed');
    expect(byColleague.json()).toMatchObject({
      error: {
        message:
          'Bu dosyayı yalnızca ekleyen kişi, projenin sahibi, yöneticileri ya da kurucu silebilir.',
      },
    });
    expect((await call(outsider, 'DELETE', url)).statusCode).toBe(404);
    expect((await call(external, 'DELETE', url)).statusCode).toBe(403);
    expect(server.storage.objects.has(keyOf(file.id))).toBe(true);
    const res = await call(employee, 'DELETE', url);
    expect(res.statusCode, res.body).toBe(204);
    expect(server.storage.objects.has(keyOf(file.id))).toBe(false);
    expect((await list(employee)).files.map((entry) => entry.id)).not.toContain(file.id);
    expect((await call(employee, 'DELETE', url)).statusCode).toBe(404);
    const trace = await adminQuery(
      `select event, user_id from office.audit_log where record_id = $1 order by id`,
      [file.id],
    );
    expect(trace).toEqual([
      { event: 'project_file_added', user_id: ids.employee },
      { event: 'project_file_deleted', user_id: ids.employee },
    ]);
    // The founder deletes a member's file.
    const second = await added(colleague, 'kurucu-siler.txt', SAMPLES.text);
    expect(
      (await call(founder, 'DELETE', `/api/projects/${project}/files/${second.id}`)).statusCode,
    ).toBe(204);

    // 11 October decision 2: the owner of the project deletes a file a member added ...
    const deletableFor = async (session: string, fileId: string) =>
      (await list(session)).files.find((entry) => entry.id === fileId)?.deletable;
    const third = await added(colleague, 'sahip-siler.txt', SAMPLES.text);
    expect(await deletableFor(employee, third.id)).toBe(true);
    expect(
      (await call(employee, 'DELETE', `/api/projects/${project}/files/${third.id}`)).statusCode,
    ).toBe(204);
    expect(server.storage.objects.has(keyOf(third.id))).toBe(false);
    expect(
      await adminQuery(
        `select event, user_id from office.audit_log where record_id = $1 order by id`,
        [third.id],
      ),
    ).toEqual([
      { event: 'project_file_added', user_id: ids.holder },
      { event: 'project_file_deleted', user_id: ids.employee },
    ]);
    // ... and so does a manager, for as long as they are one.
    const fourth = await added(founder, 'yonetici-siler.txt', SAMPLES.text);
    const fourthUrl = `/api/projects/${project}/files/${fourth.id}`;
    expect(await deletableFor(colleague, fourth.id)).toBe(false);
    const setRole = (role: string) =>
      send(server, employee, 'PUT', `/api/projects/${project}/members/${ids.holder}/role`, {
        company: ids.arma,
        payload: { role },
      });
    expect((await setRole('manager')).statusCode).toBe(200);
    expect(await deletableFor(colleague, fourth.id)).toBe(true);
    expect((await setRole('member')).statusCode).toBe(200);
    expect(await deletableFor(colleague, fourth.id)).toBe(false);
    expect(errorCode(await call(colleague, 'DELETE', fourthUrl))).toBe('file_delete_not_allowed');
    expect((await setRole('manager')).statusCode).toBe(200);
    expect((await call(colleague, 'DELETE', fourthUrl)).statusCode).toBe(204);
    expect(server.storage.objects.has(keyOf(fourth.id))).toBe(false);
    // The colleague is a plain member again for the tests that follow.
    expect((await setRole('member')).statusCode).toBe(200);
  });

  it('a storage that fails leaves nothing half done', async () => {
    // Adding: the record is rolled back.
    const id = randomUUID();
    server.storage.failing.add('put');
    const res = await upload(employee, 'depo.txt', SAMPLES.text, { id });
    expect(res.statusCode).toBe(502);
    expect(errorCode(res)).toBe('file_storage_failed');
    expect(await adminQuery('select 1 from office.files where id = $1', [id])).toEqual([]);
    expect(await adminQuery('select 1 from office.audit_log where record_id = $1', [id])).toEqual(
      [],
    );
    // The same id can be sent again once the storage answers.
    server.storage.failing.clear();
    expect((await upload(employee, 'depo.txt', SAMPLES.text, { id })).statusCode).toBe(201);
    // Deleting: the record stays, and so does the file.
    server.storage.failing.add('remove');
    const del = await call(employee, 'DELETE', `/api/projects/${project}/files/${id}`);
    expect(del.statusCode).toBe(502);
    expect(await adminQuery('select 1 from office.files where id = $1', [id])).toHaveLength(1);
    expect(server.storage.objects.has(keyOf(id))).toBe(true);
    expect(
      await adminQuery(
        `select 1 from office.audit_log where record_id = $1 and event = 'project_file_deleted'`,
        [id],
      ),
    ).toEqual([]);
    server.storage.failing.clear();
    expect(
      (await call(employee, 'DELETE', `/api/projects/${project}/files/${id}`)).statusCode,
    ).toBe(204);
  });

  it('says so when a project is full', async () => {
    const res = await send(server, founder, 'POST', '/api/projects', {
      company: ids.arma,
      payload: { id: randomUUID(), name: 'Dolu proje' },
    });
    const full = projectDetailSchema.parse(res.json()).id;
    const fill = (count: number, size: number) =>
      adminExec(`
        insert into office.files
          (id, company_id, project_id, kind, name, mime_type, size_bytes, sha256, storage_path)
        select g.id, '${ids.arma}', '${full}', 'project_file', 'dolgu.txt', 'text/plain',
               ${String(size)}, repeat('a', 64), '${ids.arma}/projects/${full}/' || g.id
        from (select gen_random_uuid() as id from generate_series(1, ${String(count)})) g;
      `);
    await fill(39, PROJECT_FILE_MAX_BYTES);
    // 975 MB are taken: 25 MB more fit, then the project is full by size.
    await fill(1, PROJECT_FILE_MAX_BYTES);
    await fill(1, 24 * 1024 * 1024 - 1);
    expect((await upload(founder, 'son.txt', Buffer.from('a'), { project: full })).statusCode).toBe(
      201,
    );
    const bySize = await upload(founder, 'fazla.txt', Buffer.from('a'), { project: full });
    expect(bySize.statusCode).toBe(409);
    expect(errorCode(bySize)).toBe('file_space_full');
    // By count: 200 files.
    await adminExec(`delete from office.files where project_id = '${full}'`);
    await fill(200, 1);
    const byCount = await upload(founder, 'fazla.txt', Buffer.from('a'), { project: full });
    expect(byCount.statusCode).toBe(409);
    expect(errorCode(byCount)).toBe('file_limit_reached');
    expect((await list(founder, full)).files).toHaveLength(200);
    // Another project is not touched.
    expect((await upload(founder, 'baska.txt', Buffer.from('a'))).statusCode).toBe(201);
  });

  it('holds only so many bytes of uploads at once, and gives them back', async () => {
    const small = createTestServer({ uploadBufferBytes: SAMPLES.text.length });
    try {
      const session = await sessionOf(small, accounts.employee);
      const send1 = (content: Buffer) => upload(session, 'x.txt', content, { server: small });
      const over = await send1(Buffer.concat([SAMPLES.text, Buffer.from('a')]));
      expect(over.statusCode).toBe(503);
      expect(errorCode(over)).toBe('uploads_busy');
      expect(over.headers.connection).toBe('close');
      // One after the other: the budget of the first is given back, also after a refusal.
      expect((await send1(SAMPLES.text)).statusCode).toBe(201);
      expect((await send1(SAMPLES.png)).statusCode).toBe(415);
      expect((await send1(SAMPLES.text)).statusCode).toBe(201);
    } finally {
      await small.close();
    }
  });

  it('where no storage is set up, the list is answered and everything else says so', async () => {
    const bare = createTestServer({ fileStorage: false });
    try {
      const session = await sessionOf(bare, accounts.employee);
      const answer = await send(bare, session, 'GET', `/api/projects/${project}/files`, {
        company: ids.arma,
      });
      expect(projectFileListSchema.parse(answer.json()).storageAvailable).toBe(false);
      // The ticket already says so, before a byte is sent ...
      const res = await upload(session, 'x.txt', SAMPLES.text, { server: bare });
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('file_storage_unavailable');
      // ... and so does the upload itself, for a ticket from a moment when there was a storage.
      const id = randomUUID();
      const late = await put(
        session,
        'x.txt',
        SAMPLES.text,
        { server: bare, id },
        forged(session, { id, sizeBytes: SAMPLES.text.length }),
      );
      expect(late.statusCode).toBe(503);
      expect(errorCode(late)).toBe('file_storage_unavailable');
    } finally {
      await bare.close();
    }
  });
  // What follows was added by the critic of the design (attempt 1): the upload path before the
  // session is known, and the storage while a transaction is open.

  /** A raw connection: what the server answers, and whether it closed, without sending a body. */
  function rawRequest(
    target: TestServer,
    head: string,
    // false: nothing of the answer is read until `read` is called, as a client that stopped
    // reading would.
    reading = true,
  ): Promise<{
    write: (bytes: Buffer) => void;
    answer: () => string;
    closed: () => boolean;
    end: () => void;
    read: () => void;
  }> {
    const port = (target.app.server.address() as AddressInfo).port;
    return new Promise((resolve) => {
      let got = '';
      let closed = false;
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(head);
        resolve({
          write: (bytes) => {
            if (!socket.destroyed) socket.write(bytes);
          },
          answer: () => got,
          closed: () => closed,
          end: () => {
            socket.destroy();
          },
          read,
        });
      });
      const read = (): void => {
        if (socket.listenerCount('data') === 0) {
          socket.on('data', (chunk) => (got += chunk.toString('latin1')));
        }
      };
      if (reading) read();
      socket.on('close', () => (closed = true));
      socket.on('error', () => undefined);
    });
  }
  const rawHead = (method: string, path: string, lines: string[]): string =>
    `${method} ${path} HTTP/1.1\r\nhost: x\r\norigin: ${PANEL_ORIGIN}\r\n` +
    `sec-fetch-site: same-origin\r\n${COMPANY_HEADER}: ${ids.arma}\r\n${lines.join('\r\n')}\r\n\r\n`;
  const statusOf = (answer: string): number => Number(/^HTTP\/1\.1 (\d{3})/.exec(answer)?.[1] ?? 0);
  const codeOf = (answer: string): string => /"code":"([a-z_]+)"/.exec(answer)?.[1] ?? '';
  const until = async (done: () => boolean, ms = 3000): Promise<void> => {
    const end = Date.now() + ms;
    while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };

  it('who gets a ticket: the founder and the members, for a file that can be sent', async () => {
    const id = randomUUID();
    const before = Date.now();
    const ok = await askTicket(employee, 1200, { id });
    expect(ok.statusCode, ok.body).toBe(200);
    const ticket = uploadTicketSchema.parse(ok.json());
    const ends = Date.parse(ticket.expiresAt);
    expect(ends).toBeGreaterThan(before + (UPLOAD_TICKET_SECONDS - 2) * 1000);
    expect(ends).toBeLessThanOrEqual(Date.now() + UPLOAD_TICKET_SECONDS * 1000);
    expect((await askTicket(founder, 1200, { id })).statusCode).toBe(200);
    expect((await askTicket(colleague, 1200, { id })).statusCode).toBe(200);
    expect((await askTicket(outsider, 1200, { id })).statusCode).toBe(404);
    const dis = await askTicket(external, 1200, { id });
    expect(dis.statusCode).toBe(403);
    expect(errorCode(dis)).toBe('insiders_only');
    expect((await askTicket(founder, 1200, { id, company: ids.pillika })).statusCode).toBe(404);
    expect((await askTicket(employee, 1200, { id, project: randomUUID() })).statusCode).toBe(404);
    expect(errorCode(await askTicket(employee, 0, { id }))).toBe('file_empty');
    expect(errorCode(await askTicket(employee, -5, { id }))).toBe('file_empty');
    const large = await askTicket(employee, PROJECT_FILE_MAX_BYTES + 1, { id });
    expect(large.statusCode).toBe(413);
    expect(errorCode(large)).toBe('file_too_large');
    expect((await askTicket(employee, PROJECT_FILE_MAX_BYTES, { id })).statusCode).toBe(200);
    for (const payload of [
      {},
      { sizeBytes: 1.5 },
      { sizeBytes: '12' },
      { sizeBytes: 12, name: 'a' },
    ]) {
      const res = await send(
        server,
        employee,
        'POST',
        `/api/projects/${project}/files/${id}/ticket`,
        {
          company: ids.arma,
          payload,
        },
      );
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const noId = await send(server, employee, 'POST', `/api/projects/${project}/files/x/ticket`, {
      company: ids.arma,
      payload: { sizeBytes: 12 },
    });
    expect(noId.statusCode).toBe(404);
    // A ticket writes nothing and reaches no storage.
    expect(server.storage.calls).toEqual([]);
    expect(await adminQuery('select 1 from office.files where id = $1', [id])).toEqual([]);
  });

  it('no body is read without a ticket for exactly this upload', async () => {
    const id = randomUUID();
    const size = SAMPLES.text.length;
    const tries: [string, string | null, string][] = [
      ['no ticket', null, employee],
      ['not a ticket', 'abc', employee],
      ["a colleague's ticket", forged(colleague, { id, sizeBytes: size }), employee],
      ['another file', forged(employee, { id: randomUUID(), sizeBytes: size }), employee],
      ['another size', forged(employee, { id, sizeBytes: size + 1 }), employee],
      [
        'another project',
        forged(employee, { id, sizeBytes: size, project: randomUUID() }),
        employee,
      ],
      [
        'another company',
        forged(employee, { id, sizeBytes: size, company: ids.pillika }),
        employee,
      ],
      ['ended', forged(employee, { id, sizeBytes: size }, () => Date.now() - 61_000), employee],
      [
        'from a later clock',
        forged(employee, { id, sizeBytes: size }, () => Date.now() + 5_000),
        employee,
      ],
      ['a made-up session', null, 'A'.repeat(43)],
    ];
    for (const [what, ticket, session] of tries) {
      const res = await put(session, 'x.txt', SAMPLES.text, { id }, ticket);
      expect(res.statusCode, what).toBe(403);
      expect(errorCode(res), what).toBe('upload_ticket_invalid');
      expect(res.headers.connection, what).toBe('close');
    }
    // The same request with its own ticket is taken.
    const good = await put(
      employee,
      'x.txt',
      SAMPLES.text,
      { id },
      forged(employee, { id, sizeBytes: size }),
    );
    expect(good.statusCode, good.body).toBe(201);
    expect(server.storage.calls.filter((entry) => entry.operation === 'put')).toHaveLength(1);
  });

  it('a ticket grants nothing: the upload is checked again in its own transaction', async () => {
    const size = SAMPLES.text.length;
    const withTicket = (session: string, options: { company?: string; project?: string } = {}) => {
      const id = randomUUID();
      return put(
        session,
        'x.txt',
        SAMPLES.text,
        { id, ...options },
        forged(session, { id, sizeBytes: size, ...options }),
      );
    };
    expect((await withTicket(outsider)).statusCode).toBe(404);
    const dis = await withTicket(external);
    expect(dis.statusCode).toBe(403);
    expect(errorCode(dis)).toBe('insiders_only');
    expect((await withTicket(founder, { company: ids.pillika })).statusCode).toBe(404);
    expect((await withTicket(employee, { project: randomUUID() })).statusCode).toBe(404);
    // A session that was closed after its ticket was given.
    const leaving = await sessionOf(server, accounts.employee);
    const id = randomUUID();
    const asked = await askTicket(leaving, size, { id });
    expect(asked.statusCode).toBe(200);
    const out = await send(server, leaving, 'POST', '/api/auth/logout', {});
    expect(out.statusCode, out.body).toBeLessThan(300);
    const late = await put(
      leaving,
      'x.txt',
      SAMPLES.text,
      { id },
      uploadTicketSchema.parse(asked.json()).ticket,
    );
    expect(late.statusCode).toBe(401);
    expect(server.storage.calls).toEqual([]);
  });

  it('only the upload takes raw bytes: every other route refuses them before the body arrives', async () => {
    const live = createTestServer({ uploadBufferBytes: 1000 });
    await live.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const file = `/api/projects/${project}/files/${randomUUID()}`;
      const raw = ['content-type: application/octet-stream', 'content-length: 3145728'];
      for (const [method, path] of [
        ['DELETE', file],
        ['POST', `${file}/ticket`],
        ['POST', `/api/projects/${project}/files`],
        ['PATCH', `/api/projects/${project}`],
      ] as const) {
        // No cookie and not one byte of the body: the answer must not wait for either.
        const request = await rawRequest(live, rawHead(method, path, raw));
        await until(() => request.answer() !== '');
        expect(statusOf(request.answer()), `${method} ${path}`).toBeGreaterThanOrEqual(400);
        expect(statusOf(request.answer()), `${method} ${path}`).toBeLessThan(500);
        expect(codeOf(request.answer()), `${method} ${path}`).not.toBe('file_too_large');
        request.end();
      }
      // The upload itself, by a stranger with a made-up cookie: refused at the door, and the
      // budget (one upload of 1000 bytes) is not touched however many of them hang on.
      const strangers = [];
      for (const letter of ['A', 'B', 'C']) {
        const request = await rawRequest(
          live,
          rawHead('PUT', file, [
            `cookie: ${SESSION_COOKIE}=${letter.repeat(43)}`,
            'content-type: application/octet-stream',
            'content-length: 900',
            `${UPLOAD_TICKET_HEADER}: 1791500000.${'A'.repeat(43)}`,
          ]),
        );
        await until(() => request.answer() !== '');
        expect(statusOf(request.answer())).toBe(403);
        expect(codeOf(request.answer())).toBe('upload_ticket_invalid');
        strangers.push(request);
      }
      const session = await sessionOf(live, accounts.employee);
      const mine = await upload(session, 'x.txt', Buffer.alloc(900, 0x61), { server: live });
      expect(mine.statusCode, mine.body).toBe(201);
      for (const request of strangers) request.end();
    } finally {
      await live.close();
    }
  });

  it('a body that stops arriving is cut off, and its bytes are given back', async () => {
    const live = createTestServer({ uploadBufferBytes: 1000, uploadDeadlineMs: () => 250 });
    await live.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const session = await sessionOf(live, accounts.employee);
      const id = randomUUID();
      const asked = await askTicket(session, 900, { id, server: live });
      const { ticket } = uploadTicketSchema.parse(asked.json());
      const slow = await rawRequest(
        live,
        rawHead('PUT', `/api/projects/${project}/files/${id}`, [
          `cookie: ${SESSION_COOKIE}=${session}`,
          'content-type: application/octet-stream',
          'content-length: 900',
          `${FILE_NAME_HEADER}: x.txt`,
          `${UPLOAD_TICKET_HEADER}: ${ticket}`,
        ]),
      );
      slow.write(Buffer.alloc(10, 0x61));
      // While it hangs, its 900 bytes are counted: a second upload does not fit.
      const busy = await upload(session, 'y.txt', Buffer.alloc(900, 0x61), { server: live });
      expect(busy.statusCode).toBe(503);
      expect(errorCode(busy)).toBe('uploads_busy');
      await until(() => slow.closed());
      expect(slow.closed()).toBe(true);
      expect(slow.answer()).toBe('');
      const next = await upload(session, 'y.txt', Buffer.alloc(900, 0x61), { server: live });
      expect(next.statusCode, next.body).toBe(201);
      expect(await adminQuery('select 1 from office.files where id = $1', [id])).toEqual([]);
    } finally {
      await live.close();
    }
  });

  it('a connection that dies after the whole body was sent gives its bytes back too', async () => {
    const storage = new GatedStorage();
    const live = createTestServer({ uploadBufferBytes: 1000, storage });
    await live.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const session = await sessionOf(live, accounts.employee);
      const id = randomUUID();
      const asked = await askTicket(session, 900, { id, server: live });
      const { ticket } = uploadTicketSchema.parse(asked.json());
      storage.hold('put');
      const gone = await rawRequest(
        live,
        rawHead('PUT', `/api/projects/${project}/files/${id}`, [
          `cookie: ${SESSION_COOKIE}=${session}`,
          'content-type: application/octet-stream',
          'content-length: 900',
          `${FILE_NAME_HEADER}: x.txt`,
          `${UPLOAD_TICKET_HEADER}: ${ticket}`,
        ]),
      );
      gone.write(Buffer.alloc(900, 0x61));
      await until(() => storage.waiting === 1);
      expect(storage.waiting).toBe(1);
      // The person closes the tab while the storage is still writing.
      gone.end();
      await new Promise((r) => setTimeout(r, 100));
      storage.release();
      await until(() => storage.waiting === 0);
      await new Promise((r) => setTimeout(r, 200));
      const next = await upload(session, 'y.txt', Buffer.alloc(900, 0x61), { server: live });
      expect(next.statusCode, next.body).toBe(201);
    } finally {
      storage.release();
      await live.close();
    }
  });

  it('a storage that hangs holds three transactions and no more', async () => {
    const storage = new GatedStorage();
    const live = createTestServer({ storage });
    try {
      const session = await sessionOf(live, accounts.employee);
      // Three projects, so that the uploads do not wait for each other in the database.
      const projects: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const res = await send(live, session, 'POST', '/api/projects', {
          company: ids.arma,
          payload: { id: randomUUID(), name: `Bekleyen ${String(index)}` },
        });
        projects.push(projectDetailSchema.parse(res.json()).id);
      }
      const kept = await upload(session, 'kalan.txt', SAMPLES.text, {
        server: live,
        project: projects[3],
      });
      expect(kept.statusCode).toBe(201);
      storage.hold('put');
      storage.hold('remove');
      const hanging = projects
        .slice(0, 3)
        .map((target) => upload(session, 'x.txt', SAMPLES.text, { server: live, project: target }));
      await until(() => storage.waiting === 3);
      expect(storage.waiting).toBe(3);
      // The fourth is refused at once, an add and a remove alike; nothing of it is left.
      const fourthId = randomUUID();
      const fourth = await upload(session, 'x.txt', SAMPLES.text, {
        server: live,
        project: projects[3],
        id: fourthId,
      });
      expect(fourth.statusCode).toBe(502);
      expect(errorCode(fourth)).toBe('file_storage_failed');
      const removal = await send(
        live,
        session,
        'DELETE',
        `/api/projects/${projects[3] ?? ''}/files/${projectFileSchema.parse(kept.json()).id}`,
        { company: ids.arma },
      );
      expect(removal.statusCode).toBe(502);
      expect(await adminQuery('select 1 from office.files where id = $1', [fourthId])).toEqual([]);
      expect(
        await adminQuery('select 1 from office.files where id = $1', [
          projectFileSchema.parse(kept.json()).id,
        ]),
      ).toHaveLength(1);
      // Other requests are answered meanwhile.
      const listed = await send(live, session, 'GET', `/api/projects/${projects[3] ?? ''}/files`, {
        company: ids.arma,
      });
      expect(listed.statusCode).toBe(200);
      storage.release();
      for (const res of await Promise.all(hanging)) expect(res.statusCode, res.body).toBe(201);
      const again = await upload(session, 'x.txt', SAMPLES.text, {
        server: live,
        project: projects[3],
        id: fourthId,
      });
      expect(again.statusCode, again.body).toBe(201);
    } finally {
      storage.release();
      await live.close();
    }
  });

  it('a storage that hangs does not make the requests of the same person wait', async () => {
    const storage = new GatedStorage();
    const live = createTestServer({ storage });
    try {
      const session = await sessionOf(live, accounts.employee);
      const other = await sessionOf(live, accounts.holder);
      const kept = await upload(session, 'kalan.txt', SAMPLES.text, { server: live });
      expect(kept.statusCode, kept.body).toBe(201);
      const listUrl = `/api/projects/${project}/files`;
      const keyHash = hashSessionKey(session);
      // The person looked at the list for two minutes: the next thing they do is the request
      // that writes the session's last activity, in its own transaction.
      await adminQuery(
        `update office.sessions set last_seen_at = now() - interval '2 minutes' where key_hash = $1`,
        [keyHash],
      );
      storage.hold('remove');
      const removal = send(
        live,
        session,
        'DELETE',
        `${listUrl}/${projectFileSchema.parse(kept.json()).id}`,
        { company: ids.arma },
      );
      await until(() => storage.waiting === 1);
      expect(storage.waiting).toBe(1);
      // The deletion waits for the storage with its transaction open. Whatever else the person
      // does meanwhile is answered, and so is everybody else.
      const within = async (pending: Promise<LightMyRequestResponse>): Promise<number> => {
        let timer: NodeJS.Timeout | undefined;
        const late = new Promise<number>((resolve) => {
          timer = setTimeout(() => {
            resolve(0);
          }, 2000);
        });
        const status = await Promise.race([pending.then((res) => res.statusCode), late]);
        clearTimeout(timer);
        return status;
      };
      expect(await within(send(live, session, 'GET', listUrl, { company: ids.arma }))).toBe(200);
      expect(await within(send(live, other, 'GET', listUrl, { company: ids.arma }))).toBe(200);
      storage.release();
      expect((await removal).statusCode).toBe(204);
      // The deletion itself counted as activity.
      expect(
        await adminQuery(
          `select last_seen_at > now() - interval '30 seconds' as fresh
           from office.sessions where key_hash = $1`,
          [keyHash],
        ),
      ).toEqual([{ fresh: true }]);
    } finally {
      storage.release();
      await live.close();
    }
  });

  it('holds only so many bytes of downloads at once, and gives them back', async () => {
    const storage = new GatedStorage();
    const live = createTestServer({ storage, downloadBufferBytes: SAMPLES.pdf.length });
    try {
      const session = await sessionOf(live, accounts.employee);
      const sent = await upload(session, 'a.pdf', SAMPLES.pdf, { server: live });
      const file = projectFileSchema.parse(sent.json());
      const url = `/api/projects/${project}/files/${file.id}/content`;
      const get = () => send(live, session, 'GET', url, { company: ids.arma });
      storage.hold('get');
      const first = get();
      await until(() => storage.waiting === 1);
      const second = await get();
      expect(second.statusCode).toBe(503);
      expect(errorCode(second)).toBe('downloads_busy');
      storage.release();
      expect((await first).statusCode).toBe(200);
      // Given back after an answer, after a refusal, and after a file whose bytes are gone.
      expect((await get()).statusCode).toBe(200);
      storage.objects.clear();
      expect(errorCode(await get())).toBe('file_content_missing');
      storage.failing.add('get');
      expect(errorCode(await get())).toBe('file_storage_failed');
      storage.failing.clear();
      expect(errorCode(await get())).toBe('file_content_missing');
    } finally {
      storage.release();
      await live.close();
    }
  });

  it('a download whose connection is gone before its record was read counts no bytes', async () => {
    const live = createTestServer({ downloadBufferBytes: SAMPLES.pdf.length });
    await live.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const session = await sessionOf(live, accounts.employee);
      const sent = await upload(session, 'a.pdf', SAMPLES.pdf, { server: live });
      const file = projectFileSchema.parse(sent.json());
      const url = `/api/projects/${project}/files/${file.id}/content`;
      // The person closes the tab at once: the request is still in its transaction when the
      // connection ends. Three of them, so that one that was cut before it was read does not hide
      // the others.
      for (let index = 0; index < 3; index += 1) {
        const gone = await rawRequest(
          live,
          rawHead('GET', url, [`cookie: ${SESSION_COOKIE}=${session}`]),
        );
        gone.end();
      }
      await new Promise((r) => setTimeout(r, 400));
      const next = await send(live, session, 'GET', url, { company: ids.arma });
      expect(next.statusCode, next.body).toBe(200);
      expect(next.rawPayload.equals(SAMPLES.pdf)).toBe(true);
    } finally {
      await live.close();
    }
  });

  it('a download that nobody reads is cut off, and its bytes are given back', async () => {
    // A file the buffers of a connection cannot swallow: the answer cannot be handed over whole.
    const content = Buffer.alloc(12 * 1024 * 1024, 0x61);
    const storage = new GatedStorage();
    const live = createTestServer({
      storage,
      downloadBufferBytes: content.length,
      downloadDeadlineMs: () => 1000,
    });
    await live.app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const session = await sessionOf(live, accounts.employee);
      const sent = await upload(session, 'buyuk.txt', content, { server: live });
      expect(sent.statusCode, sent.body).toBe(201);
      const file = projectFileSchema.parse(sent.json());
      const url = `/api/projects/${project}/files/${file.id}/content`;
      const get = () => send(live, session, 'GET', url, { company: ids.arma });
      storage.hold('get');
      const stuck = await rawRequest(
        live,
        rawHead('GET', url, [`cookie: ${SESSION_COOKIE}=${session}`]),
        false,
      );
      await until(() => storage.waiting === 1);
      expect(storage.waiting).toBe(1);
      storage.release();
      // The bytes were handed to the answer and nobody reads them: they are still counted.
      const busy = await get();
      expect(busy.statusCode).toBe(503);
      expect(errorCode(busy)).toBe('downloads_busy');
      // The deadline passes: the place is given back although the client never read a byte.
      let next = await get();
      const end = Date.now() + 5000;
      while (next.statusCode === 503 && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 100));
        next = await get();
      }
      expect(next.statusCode, next.body).toBe(200);
      expect(next.rawPayload.equals(content)).toBe(true);
      // The server closed the connection: what the client can still read is not the whole file.
      stuck.read();
      await until(() => stuck.closed());
      expect(stuck.closed()).toBe(true);
      expect(statusOf(stuck.answer())).toBe(200);
      expect(stuck.answer().length).toBeLessThan(content.length);
    } finally {
      storage.release();
      await live.close();
    }
  });
});

/** A storage in memory whose calls can be made to wait, as a storage that hangs would. */
class GatedStorage extends MemoryFileStorage {
  #held = new Set<'put' | 'get' | 'remove'>();
  #waiters: (() => void)[] = [];

  get waiting(): number {
    return this.#waiters.length;
  }

  hold(operation: 'put' | 'get' | 'remove'): void {
    this.#held.add(operation);
  }

  release(): void {
    this.#held.clear();
    for (const go of this.#waiters.splice(0)) go();
  }

  async #gate(operation: 'put' | 'get' | 'remove'): Promise<void> {
    if (this.#held.has(operation)) {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    }
  }

  override async put(key: string, content: Buffer, contentType: string): Promise<void> {
    await this.#gate('put');
    return super.put(key, content, contentType);
  }

  override async get(key: string, maxBytes: number): Promise<Buffer | null> {
    await this.#gate('get');
    return super.get(key, maxBytes);
  }

  override async remove(key: string): Promise<void> {
    await this.#gate('remove');
    return super.remove(key);
  }
}
