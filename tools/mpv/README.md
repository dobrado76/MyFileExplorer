# Portable mpv for opt-in Rich player (D33)

Binaries are **not** committed. Fetch the **pinned** Windows x64 build:

```bash
npm run tools:fetch-mpv
```

Pin file: [`scripts/mpv-pin.json`](../../scripts/mpv-pin.json) (`tag` + `asset` + `SHA-256`).
Licence notes: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

Overrides: set `MFE_MPV` to an absolute `mpv.exe`, or install `mpv` on PATH.

Packaged builds copy this folder beside the app as `mpv/` when present.
