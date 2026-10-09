# MW PinAI Studio website

Official static website for MW PinAI Studio and PaiPinTong.

## Public pages

- `index.html` - studio home
- `paipintong.html` - PaiPinTong APK download page
- `version.html` - human-readable version page
- `support.html` - support and troubleshooting
- `privacy.html` - privacy policy
- `terms.html` - terms of use
- `404.html` - GitHub Pages not-found page

## APK download

The APK is **not stored in this repository** — it is published as a GitHub Release asset:

https://github.com/mwpinaistudio/mwpinaistudio-website/releases

`version.json` holds the current download URL plus a `releases/latest` mirror, and the
pages link straight to the release asset:

- `version.json` -> `apk` (version-pinned) and `apkMirrors` (`releases/latest`)
- `paipintong.html`, `version.html`, `invite.html`

Machine-readable release metadata: `version.json`

> **The HD cutout model `downloads/models/silueta.onnx` must stay in the repo.**
> The Android app downloads it directly from
> `https://mwpinaistudio.github.io/mwpinaistudio-website/downloads/models/silueta.onnx`,
> so removing it breaks HD cutout for every installed app version.

## Updating a release

1. Build the new signed APK.
2. Create a GitHub Release with tag `v<version>` (e.g. `v1.9.86`) and attach `paipintong.apk`.
3. Update `version.json`: version, versionCode, sizeBytes, sha256, releasedAt, notes, and point
   `apk` at the new tag's asset URL.
4. Replace release notes in `paipintong.html` if needed.
5. Commit and push to GitHub.
6. Wait for GitHub Pages and test the download links.

**Never commit the APK to the repo.** Committing a ~25 MB APK on every release is what
once grew `.git` to 3 GB.

## Security rules

- Never commit the Android signing keystore.
- Never commit signing passwords, service-role keys, API secrets, or private keys.
- The APK must be signed with the same release key for every update.
- Keep an offline backup of the keystore and its password.

## Local preview

Open `index.html` directly, or run any static HTTP server in this directory.