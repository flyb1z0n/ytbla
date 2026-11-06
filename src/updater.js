const { app, net } = require('electron');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');

// electron-updater on macOS goes through Squirrel.Mac, which rejects updates unless the app is
// signed with an Apple Developer ID. This app is ad-hoc signed, so it updates itself instead.
const LATEST_RELEASE = 'https://api.github.com/repos/flyb1z0n/ytbla/releases/latest';
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

// The new bundle is swapped in after the app exits, because the running bundle can't replace itself.
const INSTALL_SCRIPT = `
  while kill -0 "$0" 2>/dev/null; do sleep 0.2; done
  rm -rf "$1.old"
  mv "$1" "$1.old" || exit 1
  if mv "$2" "$1"; then rm -rf "$1.old"; else mv "$1.old" "$1"; fi
  rm -rf "$3"
`;

const bundlePath = () => path.resolve(process.execPath, '../../..');

const isNewer = (candidate, current) => {
  const [a, b] = [candidate, current].map((v) => v.split('.').map(Number));
  const i = a.findIndex((n, j) => n !== b[j]);
  return i !== -1 && a[i] > b[i];
};

let staged = null;
let checking = false;

async function download(asset, version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ytbla-${version}-`));
  try {
    const res = await net.fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const zip = path.join(dir, asset.name);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zip));

    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(zip)) hash.update(chunk);
    if (asset.digest !== `sha256:${hash.digest('hex')}`) throw new Error('checksum mismatch');

    await promisify(execFile)('/usr/bin/ditto', ['-x', '-k', zip, dir]);
    fs.rmSync(zip);
    const bundle = fs.readdirSync(dir).find((name) => name.endsWith('.app'));
    if (!bundle) throw new Error('no app bundle in update archive');
    return { dir, bundle: path.join(dir, bundle) };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

async function check() {
  if (staged || checking) return;
  checking = true;
  try {
    const res = await net.fetch(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`release lookup failed: HTTP ${res.status}`);
    const release = await res.json();
    const version = release.tag_name.replace(/^v/, '');
    const asset = release.assets.find((a) => a.name.endsWith('-mac-universal.zip'));
    if (asset && isNewer(version, app.getVersion())) staged = await download(asset, version);
  } catch (err) {
    console.error('Update check failed:', err);
  } finally {
    checking = false;
  }
}

function install() {
  if (!staged) return;
  spawn('/bin/sh', ['-c', INSTALL_SCRIPT, String(process.pid), bundlePath(), staged.bundle, staged.dir], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

function startAutoUpdates() {
  if (!app.isPackaged || process.platform !== 'darwin') return;
  // A read-only location (mounted DMG, App Translocation) can't be updated in place.
  try {
    fs.accessSync(bundlePath(), fs.constants.W_OK);
    fs.accessSync(path.dirname(bundlePath()), fs.constants.W_OK);
  } catch {
    return;
  }
  app.on('will-quit', install);
  check();
  setInterval(check, CHECK_INTERVAL);
}

module.exports = { startAutoUpdates };
