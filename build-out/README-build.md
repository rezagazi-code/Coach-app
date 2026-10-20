# «مربی من» — Build instructions (local + CI)

Status on 2026-10-20: **prep-only — no APK was built on this machine.**
The web build passes, signing is wired, and the CI workflow is ready.

⚠️ **Local-build blocker found 2026-10-20 (after provisioning a full
toolchain — see inventory): this sandbox intercepts Java loopback TCP.**
A full JDK 17 + Android SDK were downloaded to `~/workspace/tools/`
(JDK, `android-sdk/` with platform 36 + build-tools 36.0.0 + platform-tools,
Gradle 8.14.3, SDK licenses written, `android/local.properties` set), yet
`gradle assembleRelease` can never get past daemon startup:
`Could not receive a message from the daemon`. Reproduced 15/15 attempts.
Byte-level test: a Java client connecting to a server socket on
127.0.0.1 in the same JVM reads back byte 109 from a middlebox instead of
the server's byte, its local address is NAT'd to the host interface, and
the server never sees an accept — while python/curl loopback works fine.
The Gradle daemon protocol is raw loopback TCP, so **Gradle builds are
impossible inside this VM** (this is also why PadelPro was always built
on GitHub Actions and only signed locally). Use Path B (CI) below; the
provisioned toolchain stays on disk in case the sandbox networking ever
changes. Do not re-diagnose from scratch — start from this paragraph.

- Package: `ir.coachstudio.app`
- App version in code (do not bump without Reza): `versionName "1.0"`, `versionCode 1`
  (`android/app/build.gradle`)
- Keystore: `~/workspace/secure/coach-release.jks`, alias `coachapp`
- Expected signing cert SHA-256: starts `6D:D4:AF:E4`, ends `D4:1C`
  (full fingerprint is in the project records; compare with `apksigner verify --print-certs`)
- Passwords: `~/workspace/secure/coach-keystore.env` (chmod 600) — keys
  `COACH_KEYSTORE_PASSWORD` and `COACH_KEY_PASSWORD`. Never commit this file,
  the keystore, or any password into the repo.

## Toolchain inventory — this VM, 2026-10-20 (updated after provisioning)

| Tool | Present? |
|---|---|
| Node.js v24.20.0 / npm 10.9.4 | ✅ |
| Gradle wrapper (`android/gradlew`, gradle-8.14.3) + standalone Gradle 8.14.3 at `~/workspace/tools/gradle-8.14.3` | ✅ |
| Java on PATH / `/usr/lib/jvm/` | ❌ nothing system-installed |
| Temurin **JRE** 17 (pre-existing, no `javac`/`jdk.compiler`) | ✅ `~/workspace/tools/jre17/` and `~/workspace/.signing-tools/` (+ `uber-apk-signer.jar` — socket-free, works) |
| Temurin **JDK** 17.0.20.1 (provisioned 2026-10-20) | ✅ `~/workspace/tools/jdk17/` (`javac` works) |
| Android SDK (provisioned 2026-10-20) | ✅ `~/workspace/tools/android-sdk/` — platform android-36, build-tools 36.0.0 (`aapt`/`aapt2`/`apksigner`/`d8`), platform-tools, cmdline-tools; licenses written |
| Gradle daemon build | ❌ **blocked by sandbox Java-loopback interception — see header** |

Verified working without the toolchain:

```bash
cd ~/workspace/coach-app
npx tsc --noEmit   # passes
npm run build      # passes (vite)
npx cap sync android  # passes
```

## Path A — Local build (any normal machine / if sandbox networking is fixed)

Prereqs: JDK 17, Android SDK with platform 36 + build-tools, `ANDROID_HOME` set.
On this VM the toolchain already sits at `~/workspace/tools/jdk17` and
`~/workspace/tools/android-sdk` — set `JAVA_HOME`/`ANDROID_HOME` to those
paths and the steps below apply verbatim; only the daemon-loopback
blocker (header) currently stops them here.

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
