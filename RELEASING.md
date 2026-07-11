# Releasing Lucent

Releases are **version-on-merge**: bump the version, merge to `main`, and CI
does the rest — builds macOS/Windows/Linux bundles, publishes a GitHub release,
publishes signed in-app update artifacts, and updates the Homebrew cask.

## How to cut a release

1. On a branch, bump the version in **`package.json`** only:

   ```jsonc
   // package.json
   "version": "0.4.0"
   ```

   `package.json` is the single source of truth. `src-tauri/tauri.conf.json`
   reads it via `"version": "../package.json"`, so the bundle, the git tag, and
   the in-app version all stay in sync from one edit. (`src-tauri/Cargo.toml`'s
   `version` is the Rust crate version and is independent — leave it alone.)

2. Open a PR, get CI green, merge to `main`.

3. Confirm `examples/` is present — desktop bundles include it as app resources
   (Help guide `example:` links). Web builds copy it to `public/examples/` during
   `npm run build`.

4. The **Release** workflow notices `v0.4.0` has no release yet and:
   - builds on `macos-latest` (universal `.dmg`), `ubuntu-22.04` and
     `ubuntu-24.04-arm` (`.deb`/`.rpm`/`.AppImage`), and `windows-latest`
     (`.msi`/NSIS `.exe`) into a **draft** release;
   - uploads Tauri's signed updater bundles and `latest.json` alongside the
     installers;
   - flips the release public once all four platforms finish;
   - downloads the `.dmg`, hashes it, and pushes `Casks/lucent.rb` to
     `jverhoeks/homebrew-tap`.

   The workflow creates the draft once before starting the platform matrix.
   Re-running a failed build resumes that draft; re-running after publication is
   a no-op. Matrix jobs never create releases themselves.

To trigger a build without a version change, run **Release** manually from the
Actions tab (it still skips if the release already exists).

## One-time setup

- **`HOMEBREW_TAP_TOKEN` secret** — a fine-grained PAT (or classic token with
  `repo` scope) that can **push to `jverhoeks/homebrew-tap`**. Add it under
  *Settings → Secrets and variables → Actions* in the `lucent` repo. Without it
  the build still releases; only the cask-update job fails.
- **`TAURI_SIGNING_PRIVATE_KEY` secret** — the complete contents of
  `.tauri/lucent.key`. This is Tauri's free update-integrity key, not an Apple
  Developer certificate. Add it as a repository Actions secret, then keep an
  encrypted backup outside the repository. The file is gitignored. If it is
  lost, existing installations cannot trust updates signed by a replacement
  key.

The matching public key is embedded in `src-tauri/tauri.conf.json`; it is safe
to commit. No `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret is needed for the
current unencrypted key.
- Everything else uses the built-in `GITHUB_TOKEN`.

## Installing

```bash
# macOS
brew tap jverhoeks/tap
brew install --cask lucent

# Linux / Windows
# Download the .deb/.rpm/.AppImage or .msi/.exe from the GitHub release.
```

> macOS app is currently **unsigned**. After install, run
> `xattr -cr /Applications/Lucent.app` once to clear Gatekeeper quarantine.

Lucent checks `releases/latest/download/latest.json` shortly after startup. If
a newer version exists it asks before downloading, verifies Tauri's signature,
installs, and restarts. A network failure never blocks startup.

## Editing the cask

`homebrew/lucent.rb` in this repo is canonical; the workflow stamps its
placeholders and writes the copy in the tap. Edit it here, never in the tap.

## Notes / known sharp edges

- **macOS signing** is deferred. To enable it later, add an Apple Developer cert
  + notarization credentials as secrets and pass them to `tauri-action`; then
  drop the Gatekeeper caveat from `homebrew/lucent.rb`.
- **`brew audit --cask lucent`** may warn that the URL doesn't interpolate
  `#{version}` — expected, since the workflow injects the exact published asset
  name (robust against Tauri's dmg naming).
- The first real release is the end-to-end test; the matrix/macOS build can't be
  exercised locally.
