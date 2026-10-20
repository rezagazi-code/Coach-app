# «مربی من» — Build instructions (local + CI)

Status on 2026-10-20: **prep-only — no APK was built on this machine.**
The web build passes, signing is wired, and the CI workflow is ready.
What is missing locally is only the Android toolchain (see inventory below).

- Package: `ir.coachstudio.app`
- App version in code (do not bump without Reza): `versionName "1.0"`, `versionCode 1`
  (`android/app/build.gradle`)
- Keystore: `~/workspace/secure/coach-release.jks`, alias `coachapp`
- Expected signing cert SHA-256: starts `6D:D4:AF:E4`, ends `D4:1C`
  (full fingerprint is in the project records; compare with `apksigner verify --print-certs`)
- Passwords: `~/workspace/secure/coach-keystore.env` (chmod 600) — keys
  `COACH_KEYSTORE_PASSWORD` and `COACH_KEY_PASSWORD`. Never commit this file,
  the keystore, or any password into the repo.

## Toolchain inventory — this VM, 2026-10-20

| Tool | Present? |
|---|---|
| Node.js v24.20.0 / npm 10.9.4 | ✅ |
| Gradle wrapper (`android/gradlew`, gradle-8.14.3) | ✅ present, unusable without a JDK |
| Java / javac (`java`, `javac`, `/usr/lib/jvm/`) | ❌ not installed |
| Android SDK (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, platform-tools, build-tools) | ❌ not present |
| `aapt` / `apkanalyzer` / `apksigner` / `keytool` | ❌ (ship with JDK/SDK above) |

Verified working without the toolchain:

```bash
cd ~/workspace/coach-app
npx tsc --noEmit   # passes
npm run build      # passes (vite)
npx cap sync android  # passes
```

## Path A — Local build (once JDK 17 + Android SDK are installed)

Prereqs: JDK 17, Android SDK with platform 36 + build-tools, `ANDROID_HOME` set.

```bash
cd ~/workspace/coach-app
npm ci
npx tsc --noEmit
npm run build
npx cap sync android

# Load signing secrets from OUTSIDE the repo (values are never printed/committed):
set -a; . ~/workspace/secure/coach-keystore.env; set +a
export COACH_KEYSTORE_FILE=~/workspace/secure/coach-release.jks
# COACH_KEY_ALIAS is optional — build.gradle defaults it to "coachapp".

cd android && chmod +x gradlew && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`android/app/build.gradle` reads the keystore + passwords only from the
environment variables / Gradle properties above (`COACH_KEYSTORE_FILE`,
`COACH_KEYSTORE_PASSWORD`, `COACH_KEY_PASSWORD`, `COACH_KEY_ALIAS`) and
enables v2 + v3 signing (v1 disabled). If the env vars are absent, the
release build type is left unsigned instead of failing config evaluation —
never ship an unsigned APK as a release.

Verify before delivering (mandatory):

```bash
APK=android/app/build/outputs/apk/release/app-release.apk
aapt dump badging "$APK" | head -3
#   expect: package: name='ir.coachstudio.app' versionCode='1' versionName='1.0'
apksigner verify --verbose --print-certs "$APK"
#   expect: v2 scheme: true, v3 scheme: true,
#           signer cert SHA-256 starting 6D:D4:AF:E4 and ending D4:1C
sha256sum "$APK"; ls -lh "$APK"
cp "$APK" ~/workspace/coach-app/build-out/
```

Then write `build-out/verification.txt` with: date, git commit SHA, package,
versionName/versionCode, v2/v3 results, cert SHA-256, APK size, APK sha256.

## Path B — GitHub Actions (no local toolchain needed)

Workflow: `.github/workflows/build-apk.yml` (checkout → Java 17 → Node →
Android SDK → `npm ci` → tsc → `npm run build` → `npx cap sync android` →
decode keystore → `./gradlew assembleRelease` → apksigner verify → upload artifact).

Required repo secrets (add tonight, see the workflow file header):

- `COACH_KEYSTORE_BASE64` — `base64 -w0 ~/workspace/secure/coach-release.jks`
- `COACH_KEYSTORE_PASSWORD`
- `COACH_KEY_PASSWORD`
- `COACH_KEY_ALIAS` — optional, defaults to `coachapp`

⚠️ **Push caveat:** the project's API-push helper excludes `.github/` files,
so `build-apk.yml` must reach GitHub another way — GitHub web upload
(Add file → Upload files) or a normal `git push` that includes `.github/`.
Also note (project records): the repo itself may not be on GitHub yet —
creating it / fixing token scope is Reza's account-side step.

After the run: download the `morabi-man-release-apk` artifact, re-verify it
locally with the commands above if SDK tools become available, and record
`build-out/verification.txt` before sending Reza a shareable link.
