import { app } from 'electron';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { recoverInlineAttachments, type OversizedRequestRecovery } from '@cindy/anthropic-compat-proxy';
import { getCurrentDbClientSnapshot } from '../localDb/client/current.js';
import { sessions, mediaRefs } from '../localDb/schema.js';
import { captureMediaRefCompensationScope } from '../cindy-media/refCompensationJournal.js';
import { ingestMedia } from '../cindy-media/ingest.js';
import { resolveSafe } from '../cindy-media/blobStore.js';
import { sniffMediaMime } from '../cindy-media/sniffMediaMime.js';

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** All three local harnesses share this overflow-only recovery and storage lifecycle. */
export function createAttachmentRecovery(
  resolveSession: (headers: Record<string, string>) => string | null | undefined,
): OversizedRequestRecovery {
  return ctx => {
    if (!/\/(?:responses(?:\/compact)?|messages|chat\/completions)(?:\?|$)/.test(ctx.url)) return null;
    const sessionId = resolveSession(ctx.headers);
    if (!sessionId || !/^[\w-]+$/.test(sessionId)) return null;
    const snapshot = getCurrentDbClientSnapshot();
    if (!snapshot) return null;
    const scope = captureMediaRefCompensationScope();
    const db = snapshot.client.drizzle;
    const assertCurrent = () => {
      scope.assertStillValid();
      if (getCurrentDbClientSnapshot() !== snapshot || resolveSession(ctx.headers) !== sessionId) {
        throw new Error('Attachment recovery owner changed');
      }
    };
    return async (body, targetBytes) => {
      assertCurrent();
      const session = await db.select({ status: sessions.status, remoteHostId: sessions.remoteHostId })
        .from(sessions).where(eq(sessions.id, sessionId)).get();
      assertCurrent();
      // A Desktop path must never be presented as a path on an SSH host.
      if (!session || session.status === 'deleted' || session.remoteHostId) return null;
      return recoverInlineAttachments(body, targetBytes, async attachment => {
        body.signal.throwIfAborted();
        assertCurrent();
        const probe = Buffer.alloc(64 * 1024);
        const handle = await open(attachment.filePath, 'r');
        let bytesRead: number;
        try { ({ bytesRead } = await handle.read(probe, 0, probe.length, 0)); }
        finally { await handle.close(); }
        assertCurrent();
        const mimeType = sniffMediaMime(probe.subarray(0, bytesRead), attachment.mimeType);
        const hash = await hashFile(attachment.filePath);
        body.signal.throwIfAborted();
        assertCurrent();
        if (mimeType) {
          const existing = await db.select({ id: mediaRefs.id }).from(mediaRefs)
            .where(and(eq(mediaRefs.hash, hash), eq(mediaRefs.refKind, 'session-attachment'), eq(mediaRefs.refId, sessionId))).get();
          assertCurrent();
          const media = await ingestMedia({
            filePath: attachment.filePath,
            mimeType,
            isCache: false,
            refs: existing ? [] : [{ refKind: 'session-attachment', refId: sessionId, originSessionId: sessionId, originKind: 'user' }],
            assertStillValid: assertCurrent,
            refCompensationScope: scope,
          }, db);
          assertCurrent();
          return resolveSafe(media.url).absPath;
        }
        // Non-media uses the existing session attachment directory and deletion
        // lifecycle. Do not trust filenames or MIME claims to choose executables.
        const ext = probe.subarray(0, 5).toString() === '%PDF-' ? '.pdf' : '.bin';
        const root = path.join(app.getPath('userData'), 'hook-attachments');
        const dir = path.join(root, sessionId);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        assertCurrent();
        if ((await lstat(root)).isSymbolicLink() || (await lstat(dir)).isSymbolicLink() || path.dirname(await realpath(dir)) !== await realpath(root)) {
          throw new Error('Invalid attachment directory');
        }
        const file = path.join(dir, `${hash}-recovered${ext}`);
        try { await copyFile(attachment.filePath, file, constants.COPYFILE_EXCL); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        assertCurrent();
        const stat = await lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || await hashFile(file) !== hash) {
          throw new Error('Recovered attachment verification failed');
        }
        body.signal.throwIfAborted();
        assertCurrent();
        return file;
      });
    };
  };
}
