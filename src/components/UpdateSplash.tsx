/**
 * UpdateGate — boot gate for the in-app self-updater (Android only).
 *
 * On native, the app opens on this splash BEFORE the auth gate: the neon
 * logo sits inside an SVG ring; the ring spins while checking, then fills
 * with REAL download progress (bytes from the native listener, via
 * src/lib/updater.ts) until the verified APK is handed to the system
 * installer. Every state keeps the "continue without updating" escape
 * hatch visible — fail open, always: a broken update server can never
 * trap Reza or a trainee out of the app (PadelPro 0% lesson).
 *
 * On web / demo the gate is a pass-through: the app behaves exactly as
 * before and no update check runs.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLang } from '../lib/i18n';
import {
  checkForUpdate,
  deleteUpdateFile,
  downloadUpdate,
  errMsg,
  isNativePlatform,
  openInstaller,
  UpdateStageError,
  verifySha256,
  type UpdateMetadata,
  type UpdateStage,
} from '../lib/updater';

type Phase = 'checking' | 'downloading' | 'verifying' | 'installing' | 'error';

/** Once the gate has been passed in this app session, remounts (tab
 *  switches, StrictMode) never re-run the check or re-show the splash. */
let sessionGatePassed = false;

const RING_R = 80;
const RING_C = 2 * Math.PI * RING_R;

export default function UpdateGate({ children }: { children: ReactNode }) {
  const { t, dir, lang, num } = useLang();
  const [passed, setPassed] = useState(() => sessionGatePassed || !isNativePlatform());
  const [phase, setPhase] = useState<Phase>('checking');
  const [progress, setProgress] = useState(0);
  const [meta, setMeta] = useState<UpdateMetadata | null>(null);
  const [hashFailed, setHashFailed] = useState(false);
  /** The last stage-tagged failure — drives the honest error state. */
  const [stageErr, setStageErr] = useState<UpdateStageError | null>(null);
  const runningRef = useRef(false);

  const pass = useCallback(() => {
    sessionGatePassed = true;
    setPassed(true);
  }, []);

  /** Normalize any throwable into a stage-tagged error for the UI. */
  const toStageError = useCallback((err: unknown, fallback: UpdateStage): UpdateStageError => {
    if (err instanceof UpdateStageError) return err;
    return new UpdateStageError(fallback, errMsg(err));
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase('checking');
    setProgress(0);
    setHashFailed(false);
    setStageErr(null);
    try {
      let found: UpdateMetadata | null;
      try {
        found = await checkForUpdate(); // throws UpdateStageError('check', …)
      } catch (err) {
        throw toStageError(err, 'check');
      }
      if (!found) {
        pass(); // up to date — dismiss immediately, no artificial delay
        return;
      }
      setMeta(found);
      setPhase('downloading');
      const file = await downloadUpdate(found, setProgress); // throws UpdateStageError('download', …)
      setPhase('verifying');
      let ok: boolean;
      try {
        ok = await verifySha256(file, found.sha256);
      } catch (err) {
        throw toStageError(err, 'verify');
      }
      if (!ok) {
        // Never open an unverified installer; drop the bad file.
        await deleteUpdateFile().catch(() => undefined);
        setHashFailed(true);
        throw new UpdateStageError('verify', 'sha256 mismatch');
      }
      setPhase('installing');
      try {
        await openInstaller(file);
      } catch (err) {
        throw toStageError(err, 'installer');
      }
      pass();
    } catch (err) {
      setStageErr(toStageError(err, 'check'));
      setPhase('error');
    } finally {
      runningRef.current = false;
    }
  }, [pass, toStageError]);

  useEffect(() => {
    if (!passed) void run();
  }, [passed, run]);

  if (passed) return <>{children}</>;

  const downloading = phase === 'downloading';
  const dashOffset = downloading ? RING_C * (1 - progress) : RING_C * 0.75;
  /** Honest, stage-specific status: the user always sees WHICH stage failed. */
  const stageText = (stage: UpdateStage): string =>
    stage === 'check'
      ? t('upd.errCheck')
      : stage === 'download'
        ? t('upd.errDownload')
        : stage === 'verify'
          ? t('upd.errVerify')
          : t('upd.errInstaller');
  const statusText =
    phase === 'checking'
      ? t('upd.checking')
      : phase === 'downloading'
        ? t('upd.downloading')
        : phase === 'verifying'
          ? t('upd.verifying')
          : phase === 'installing'
            ? t('upd.installing')
            : hashFailed
              ? t('upd.hashFailed')
              : stageErr
                ? stageText(stageErr.stage)
                : t('upd.failed');

  return (
    <div className="upd-splash" dir={dir} role="status" aria-live="polite">
      <div className="upd-ring-wrap">
        <svg className="upd-ring-svg" viewBox="0 0 190 190" aria-hidden="true">
          <defs>
            <linearGradient id="upd-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D4FF00" />
              <stop offset="100%" stopColor="#00F0FF" />
            </linearGradient>
          </defs>
          <circle className="upd-track" cx="95" cy="95" r={RING_R} />
          <circle
            className={`upd-bar${downloading ? '' : ' upd-bar-ind'}`}
            cx="95"
            cy="95"
            r={RING_R}
            strokeDasharray={RING_C}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <img src="logo.png" alt={t('app.name')} className="upd-logo" />
      </div>

      {meta && phase !== 'error' && (
        <p className="upd-available">
          {t('upd.available')} — {num(meta.versionName)}
        </p>
      )}
      <p className="upd-status">{statusText}</p>
      {downloading && (
        <p className="upd-pct">
          {num(Math.floor(progress * 100))}
          {lang === 'fa' ? '٪' : '%'}
        </p>
      )}

      {phase === 'error' && stageErr && (
        <details className="upd-details">
          <summary>{t('upd.details')}</summary>
          <p className="upd-details-body">{stageErr.message}</p>
        </details>
      )}

      <div className="upd-actions">
        {phase === 'error' && (
          <button type="button" className="btn-primary upd-btn" onClick={() => void run()}>
            {t('upd.retry')}
          </button>
        )}
        <button type="button" className="btn-ghost upd-btn" onClick={pass}>
          {t('upd.skip')}
        </button>
      </div>
    </div>
  );
}
