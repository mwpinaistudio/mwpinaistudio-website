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

Stable APK path:

`downloads/paipintong.apk`

Machine-readable release metadata:

`version.json`

## Updating a release

1. Build the new signed APK.
2. Replace `downloads/paipintong.apk`.
3. Update `version.json` with the new version, version code, file size, SHA-256, release date, and notes.
4. Replace release notes in `paipintong.html` if needed.
5. Commit and push to GitHub.
6. Wait for GitHub Pages and test the download links.

## Security rules

- Never commit the Android signing keystore.
- Never commit signing passwords, service-role keys, API secrets, or private keys.
- The APK must be signed with the same release key for every update.
- Keep an offline backup of the keystore and its password.

## Local preview

Open `index.html` directly, or run any static HTTP server in this directory.