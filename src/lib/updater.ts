/**
 * مربی من — in-app APK self-updater (Android native only; no-op on web).
 *
 * Reza's explicit request (2026-10-21): tapping the app icon should check
 * for a newer version and update IN the app — a circular loading ring
 * around the logo showing real download progress until the installer
 * opens. PadelPro's updater once stuck at 0% on his phone, so the
 * safeguards below are mandatory, not optional:
 *
 *  1. Metadata: latest.json attached to the newest GitHub Release
 *     (releases/latest/download/latest.json redirects to it).
 *  2. The metadata fetch has an 8s timeout and exactly one retry.
 *  3. FAIL OPEN: every failure path offers "continue without updating" —
 *     the user is NEVER trapped on this screen.
 *  4. The downloaded APK's SHA-256 must match latest.json before the
 *     installer opens; on mismatch the file is deleted.
 *  5. Progress comes from the native download listener — real bytes,
 *     never a fake/animated percentage.
 *  6. The apkUrl is a GitHub 302 link — resolved to its final URL with a
 *     plain web fetch (which follows redirects natively) BEFORE calling
 *     downloadFile, which does not follow the redirect reliably (fixed
 *     2026-10-21 after Reza's phone saved a redirect body instead of
 *     the APK). Errors are stage-tagged (check/download/verify/
 *     installer) so the UI can say WHICH stage failed.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capawesome-team/capacitor-file-opener';

export const LATEST_JSON_URL =
  'https://github.com/rezagazi-code/Coach-app/releases/latest/download/latest.json';

const FETCH_TIMEOUT_MS = 8000;
const UPDATE_DIR = 'update';
const UPDATE_FILE = 'morabi-man-update.apk';
const APK_MIME = 'application/vnd.android.package-archive';

export interface UpdateMetadata {
  versionName: string;
  versionCode: number;
  apkUrl: string;
  sha256: string;
  sizeBytes: number;
  notes?: string;
}

/** True only inside the installed Android app — web/demo never updates. */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/* ------------------------------------------------------------------ *
 * Pure helpers (unit-tested in qa-probe/updater-test.mjs)             *
 * ------------------------------------------------------------------ */

/** Validate + normalize an untrusted latest.json payload. */
export function parseUpdateMetadata(json: unknown): UpdateMetadata | null {
  if (typeof json !== 'object' || json === null) return null;
  const o = json as Record<string, unknown>;
  const versionName = typeof o.versionName === 'string' ? o.versionName.trim() : '';
  const versionCode = typeof o.versionCode === 'number' ? Math.trunc(o.versionCode) : NaN;
  const apkUrl = typeof o.apkUrl === 'string' ? o.apkUrl.trim() : '';
  const sha256 = typeof o.sha256 === 'string' ? o.sha256.trim().toLowerCase() : '';
  const sizeBytes = typeof o.sizeBytes === 'number' ? Math.trunc(o.sizeBytes) : 0;
  if (!versionName || !Number.isFinite(versionCode) || versionCode <= 0) return null;
  if (!/^https:\/\//.test(apkUrl)) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    versionName,
    versionCode,
    apkUrl,
    sha256,
    sizeBytes: sizeBytes > 0 ? sizeBytes : 0,
    notes: typeof o.notes === 'string' ? o.notes : undefined,
  };
}

/** An update exists only when the remote build number is strictly newer. */
export function isUpdateAvailable(remoteCode: number, currentCode: number): boolean {
  return Number.isFinite(remoteCode) && Number.isFinite(currentCode) && remoteCode > currentCode;
}

/** Real progress as 0..1; unknown/invalid totals report 0 (never fake). */
export function progressRatio(bytes: number, contentLength: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(contentLength) || contentLength <= 0) return 0;
  const r = bytes / contentLength;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

/** SHA-256 of an in-memory buffer, lowercase hex (node-testable). */
export async function computeSha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ *
 * Staged errors — Reza's standing rule: the UI must always say WHICH  *
 * stage failed, never show a silent generic box.                      *
 * ------------------------------------------------------------------ */

export type UpdateStage = 'check' | 'download' | 'verify' | 'installer';

/** An updater failure tagged with the stage that produced it. */
export class UpdateStageError extends Error {
  readonly stage: UpdateStage;
  constructor(stage: UpdateStage, message: string) {
    super(message);
    this.name = 'UpdateStageError';
    this.stage = stage;
  }
}

/** Human-safe message extraction from unknown throwables. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Decode one base64 chunk (each filesystem chunk is independently valid). */
export function base64ChunkToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ *
 * Native operations                                                   *
 * ------------------------------------------------------------------ */

/** Installed build number (Android versionCode) via @capacitor/app. */
export async function getCurrentVersionCode(): Promise<number> {
  const info = await App.getInfo();
  const code = Number.parseInt(info.build, 10);
  return Number.isFinite(code) ? code : 0;
}

async function fetchJsonOnce(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Race as a second guard: even if a native HTTP bridge ignores the
    // abort signal, the caller is released after timeoutMs (fail open).
    return await Promise.race([
      (async () => {
        const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(`latest.json HTTP ${res.status}`);
        return (await res.json()) as unknown;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('latest.json timeout')), timeoutMs),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch latest.json (8s timeout, one retry) and compare against the
 * installed versionCode. Returns the metadata when a newer version
 * exists, null when up to date. THROWS when the check itself failed
 * (offline, bad payload) so the UI can offer retry / continue.
 */
export async function checkForUpdate(): Promise<UpdateMetadata | null> {
  const current = await getCurrentVersionCode();
  const url = `${LATEST_JSON_URL}?t=${Date.now()}`;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const meta = parseUpdateMetadata(await fetchJsonOnce(url, FETCH_TIMEOUT_MS));
      if (!meta) throw new Error('latest.json has an unexpected shape');
      return isUpdateAvailable(meta.versionCode, current) ? meta : null;
    } catch (err) {
      lastError = err;
    }
  }
  throw new UpdateStageError('check', errMsg(lastError) || 'update check failed');
}

/**
 * Resolve the final download URL before handing it to the native layer.
 *
 * GitHub release download links (…/releases/download/…) answer with a 302
 * redirect to objects.githubusercontent.com. @capacitor/filesystem's
 * downloadFile does NOT reliably follow that redirect — live failure on
 * 2026-10-21: the ring showed, the "download" completed with a redirect
 * body instead of the APK, and the size gate correctly rejected it. Plain
 * web fetch follows redirects natively, so resolve the chain here first.
 *
 * Strategy: HEAD with redirect:follow (cheap, no body); if HEAD is
 * refused, fall back to GET with Range: bytes=0-0 (one byte, then drop
 * the stream). Both are bounded by the fetch timeout.
 */
export async function resolveFinalUrl(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const fetchOnce = (init: RequestInit) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Second guard: release the caller even if a native HTTP bridge
    // ignores the abort signal (same pattern as fetchJsonOnce).
    const raced = Promise.race([
      fetch(url, { ...init, redirect: 'follow', cache: 'no-store', signal: ctrl.signal }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('redirect-resolve timeout')), timeoutMs),
      ),
    ]);
    return raced.finally(() => clearTimeout(timer));
  };
  try {
    const head = await fetchOnce({ method: 'HEAD' });
    // Even a refused HEAD (405/403) is fine: with redirect:'follow' the
    // Location chain was already walked — response.url is the final URL.
    if (head.url && head.url !== '') return head.url;
  } catch {
    // fall through to the Range-GET fallback below
  }
  const res = await fetchOnce({ headers: { Range: 'bytes=0-0' } });
  try {
    await res.body?.cancel();
  } catch {
    // dropping the one-byte body is best-effort; the URL is what matters
  }
  if (!res.url) throw new Error('could not resolve redirect');
  return res.url;
}

export interface DownloadedUpdate {
  path: string;
  directory: Directory;
}

/**
 * Download the APK into the app cache with REAL progress events from the
 * native filesystem listener (throttled natively to ~100ms chunks).
 *
 * The metadata apkUrl is a GitHub 302 link, so the final URL is resolved
 * first (see resolveFinalUrl) — downloadFile gets a direct URL the native
 * layer can actually fetch.
 */
export async function downloadUpdate(
  meta: UpdateMetadata,
  onProgress: (ratio: number) => void,
): Promise<DownloadedUpdate> {
  const path = `${UPDATE_DIR}/${UPDATE_FILE}`;
  await deleteUpdateFile().catch(() => undefined);
  const finalUrl = await resolveFinalUrl(meta.apkUrl).catch((err) => {
    throw new UpdateStageError('download', `could not resolve download URL: ${errMsg(err)}`);
  });
  const handle = await Filesystem.addListener('progress', (status) => {
    // The listener also fires for any other transfer; only ours counts.
    // Accept both URLs — the native layer reports whichever it was told.
    if (status.url === finalUrl || status.url === meta.apkUrl)
      onProgress(progressRatio(status.bytes, status.contentLength));
  });
  try {
    await Filesystem.downloadFile({
      url: finalUrl,
      path,
      directory: Directory.Cache,
      progress: true,
      recursive: true,
    });
  } catch (err) {
    throw new UpdateStageError('download', `downloadFile failed: ${errMsg(err)}`);
  } finally {
    await handle.remove().catch(() => undefined);
  }
  if (meta.sizeBytes > 0) {
    const stat = await Filesystem.stat({ path, directory: Directory.Cache });
    // Defensive early gate (before the authoritative hash): the classic
    // failure is a redirect body saved instead of the APK (~KB vs ~MB).
    if (stat.size < Math.min(meta.sizeBytes * 0.9, 1_000_000)) {
      throw new UpdateStageError(
        'download',
        `incomplete download (likely redirect): got ${stat.size} of ${meta.sizeBytes} bytes`,
      );
    }
    // Cheap pre-check before the authoritative hash: a truncated download
    // must never reach the installer.
    if (stat.size !== meta.sizeBytes) {
      throw new UpdateStageError(
        'download',
        `download size mismatch: got ${stat.size}, expected ${meta.sizeBytes}`,
      );
    }
  }
  onProgress(1);
  return { path, directory: Directory.Cache };
}

/**
 * SHA-256 of the downloaded file, read in chunks so the ~5MB APK is
 * assembled incrementally instead of one giant base64 string. Falls back
 * to a single readFile if the chunked API is unavailable.
 */
export async function verifySha256(file: DownloadedUpdate, expected: string): Promise<boolean> {
  const want = expected.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(want)) return false;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      void Filesystem.readFileInChunks(
        { path: file.path, directory: file.directory, chunkSize: 512 * 1024 },
        (chunk, err) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          if (chunk === null) {
            resolve();
            return;
          }
          if (typeof chunk.data !== 'string') {
            reject(new Error('unexpected non-string chunk from readFileInChunks'));
            return;
          }
          const bytes = base64ChunkToBytes(chunk.data);
          chunks.push(bytes);
          total += bytes.length;
        },
      ).catch(reject);
    });
  } catch {
    const whole = await Filesystem.readFile({ path: file.path, directory: file.directory });
    const bytes = base64ChunkToBytes(typeof whole.data === 'string' ? whole.data : '');
    chunks.length = 0;
    chunks.push(bytes);
    total = bytes.length;
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return (await computeSha256Hex(all)) === want;
}

/** Delete the cached update APK (used after a hash mismatch / failure). */
export async function deleteUpdateFile(): Promise<void> {
  await Filesystem.deleteFile({
    path: `${UPDATE_DIR}/${UPDATE_FILE}`,
    directory: Directory.Cache,
  });
}

/** Hand the verified APK to the Android package installer. */
export async function openInstaller(file: DownloadedUpdate): Promise<void> {
  const { uri } = await Filesystem.getUri({ path: file.path, directory: file.directory });
  await FileOpener.openFile({ path: uri, mimeType: APK_MIME });
}
