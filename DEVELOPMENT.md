# Development

## Running locally

You need Node.js 22 or later.

```sh
npm install
npm start        # run the app
npm run dist     # build installers for the current OS into dist/
```

`npm run dist` builds for the OS you run it on: a universal `.dmg` on macOS, an NSIS installer on Windows, and an AppImage on Linux. Builds are unsigned, and the macOS build is ad-hoc signed.

## How it's put together

ytbla is plain Electron with no framework and no build step. There are three source files:

- **`src/main.js`** is the main process. It creates the window, serves the player page, hides YouTube's interface, handles moving between displays, and stores settings.
- **`src/player.html`** is the player page. It loads the YouTube IFrame API and contains the auto-hiding controls, the stream picker, and keyboard and mouse handling.
- **`src/preload.js`** is the bridge between the two. It exposes a small `window.ytbla` API for full screen, settings, and the picker state.

A few details that aren't obvious from the code alone:

- **Local HTTP server.** YouTube refuses to play embeds from a `file://` page (error 153), so the main process serves `player.html` from `http://127.0.0.1` on a random port.
- **Hiding YouTube's UI.** When the YouTube iframe finishes loading, the main process injects a stylesheet into it that hides the title, branding, cards, end screens, and other overlays. A transparent shield element over the video swallows mouse input, so YouTube never shows its hover controls. If YouTube renames its player classes, `PLAYER_CSS` in `src/main.js` is the place to update.
- **Settings.** The last stream, volume, and mute state are saved to `settings.json` in the app's user data folder. On macOS that's `~/Library/Application Support/ytbla/settings.json`. Delete it to see the first-run stream picker again.
- **Multiple displays.** macOS puts a window that straddles two displays into full screen on the display holding most of its area, not the one under the cursor. To avoid jumping screens, the window is moved fully onto the cursor's display after it's dragged, and before full screen when it's triggered with the mouse.
- **Presets.** The preset streams are the `PRESETS` list in `src/player.html`. Each entry is a YouTube video ID and a title.

## App icon

The icon source is `build/icon.svg`. electron-builder picks up `build/icon.png` and generates the platform icons from it, so after editing the SVG, regenerate the PNG:

```sh
rsvg-convert -w 1024 -h 1024 build/icon.svg -o build/icon.png
```

`rsvg-convert` comes with `librsvg` (`brew install librsvg`).

## Releases

Releases are fully automated by [`.github/workflows/release.yml`](.github/workflows/release.yml). Every push to `main` (in practice, every merged PR):

1. Finds the latest `v*` tag and bumps its patch number, for example `v1.0.1` to `v1.0.2`.
2. Tags the commit and creates a draft GitHub release with generated notes.
3. Builds the macOS, Windows, and Linux installers in parallel and uploads them to the draft.
4. Publishes the release and marks it as latest once all three builds succeed.

Changes that only touch Markdown files or `.gitignore` don't trigger a release. You can also start a release by hand from the **Actions** tab with **Run workflow**.

The `version` in `package.json` isn't used for releases, because CI sets it from the tag at build time. To move to a new minor or major version, push a tag on `main` yourself, for example `git tag v1.1.0 && git push origin v1.1.0`. The next release then continues from that tag as `v1.1.1`.

If one platform's build fails, the release stays a draft and isn't published. Fix the problem and merge again, or delete the draft and its tag and rerun the workflow.
