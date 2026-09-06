# Third-party notices — Rich player (mpv)

MyFileExplorer optionally bundles a Windows build of **mpv** for Settings → Preview →
**Rich player (mpv)** (D33). Binaries are fetched by `npm run tools:fetch-mpv` from the
pinned release in [`scripts/mpv-pin.json`](../../scripts/mpv-pin.json) (not “latest”).

## mpv

- Project: https://mpv.io/
- Upstream Windows builds used here: https://github.com/shinchiro/mpv-winbuild-cmake
- Licence: **GPL-2.0-or-later** (see https://github.com/mpv-player/mpv/blob/master/Copyright)

mpv incorporates many libraries (notably **FFmpeg** and others). Their licences include
GPL, LGPL, and other terms as documented by the mpv and FFmpeg projects. The pinned
binary tree under `tools/mpv/` (after fetch) may also ship accompanying notice files from
the upstream archive; keep those with any redistributed build.

## FFmpeg (via mpv)

- Project: https://ffmpeg.org/
- Typical licence for common builds: **LGPL-2.1+** and/or **GPL** depending on
  configure options in the upstream winbuild. See https://ffmpeg.org/legal.html

## Updating the pin

Bump `tag`, `asset`, `url`, and `sha256` together in one deliberate commit, then:

```bash
npm run tools:fetch-mpv -- --force
```

Verify the new SHA-256 before committing the pin change. Do not point fetch at
`/releases/latest`.
