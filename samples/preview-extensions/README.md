# Preview extension samples

One small file per preview-supported extension so you can open this folder in MyFileExplorer and click through the pane.

Regenerate (needs `npm install`):

```bash
npm run samples:preview
```

Files are grouped by preview kind. Names are `sample.<ext>` (or `sample.tar.gz` / `sample.gitignore`).

| Folder | What to check |
| ------ | ------------- |
| `images/` | Raster / SVG / ICO / HDR / TGA / PSD |
| `audio/` | Player + tags |
| `video/` | Player, remux, or strip-only (AVI/DivX) |
| `documents/` | PDF, Office, RTF, Markdown, HTML, SAMI |
| `text-code/` | Highlighted text, ICS agenda, EML message |
| `archives/` | Contents tree (ZIP / 7z / TAR / APK / …) |
| `other/` | Font, 3D, SafeTensors, shortcut, PE |

**Also in `text-code/`:** `.ics` / `.ical` (agenda), `.eml` (email), `.srt` / `.sub` (subtitles), plus Unity YAML extras (`.asset` / `.unity` / `.prefab` / …) and `.cue` / `.ccd`.

**Stubs (typed correctly, limited parse):** `.doc` / `.ppt` (OLE magic only), `.psd` (header), `.ttf` (table stub — no pangram).

**Not generated** (need a real app or SDK): `.chm` (HTML Help compiler), `.msi` (Windows Installer), `.rar` (no packer in-repo), Outlook `.msg`. Drop your own copies here if you have them.

Mapped / remote listing cache is unrelated — these are local files.
