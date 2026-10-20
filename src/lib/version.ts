/**
 * App version — SINGLE SOURCE OF TRUTH is package.json "version".
 * (PadelPro lesson: version constants mirrored in build.gradle and app
 * code drifted apart → a false perpetual update nag and a wrong
 * user-visible version line. Here every consumer derives from the one
 * value: this module for the web bundle, android/app/build.gradle reads
 * the same package.json for versionName, CI derives versionCode.)
 */
import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;
