# Media metadata (D50)

**Status:** Unreleased (on `0.8.1` development builds) · Decision **D50** · **Windows / NTFS only**

Opt-in movie and TV metadata for a local media library. Titles, posters, genres, cast, and a watched flag live on the **file or folder** as NTFS alternate data streams — not as `.nfo` sidecars and not under `%APPDATA%`.

Locked choice: [DECISIONS.md](DECISIONS.md) **D50**. Streams: [ADS.md](ADS.md). Settings keys: [PROJECT_FORMAT.md](PROJECT_FORMAT.md). IPC: [IPC_CONTRACT.md](IPC_CONTRACT.md).

---

## What you get

| You see | When |
| ------- | ---- |
| Context menu **Media Metadata** | Settings → Media Metadata is **on**, and the selection is a **folder** or a **video file** |
| Title + poster above the preview player | The selected item has stored metadata |
| Poster as the icon thumb | **Folders** (movie/show card) use the stored cover instead of the folder icon (shrink-to-fit; XL icons only hides the folder name). **Episode files** keep `!VIDTHUMB_CACHE` strip thumbs — not the show poster. Preview uses the show cover when the episode has none. Episode tiles show `S01E07` when that metadata is stored (season defaults to 1 if missing), otherwise the filename; the tooltip is always the filename |
| **Change cover** picker | Context menu (single item) or the link under the preview title |
| **Mark as Watched** / **Unwatched** | Context menu, and a button on the preview when metadata exists |
| Toolbar **Watched** + **Genre** filters | You are inside a folder marked as a media container (see below) |

Nothing of this appears until you turn the feature on. A first install stays a plain file manager.

---

## Turn it on

**Settings → Media Metadata → Enable** (`mediaMetadata.enabled`, default **off**).

| Setting | Purpose |
| ------- | ------- |
| **Cover art size** | Preview poster height, 56–240 px (default **120**). Width follows 2:3. |
| **Plex URL** | Local server, default `http://127.0.0.1:32400`. `localhost` is mapped to `127.0.0.1`. |
| **Plex token** | Optional override. If empty, the app reads it from Plex `Preferences.xml`. |
| **Plex data folder** | Optional override of the on-disk library (`Metadata` bundles + SQLite). Leave empty to auto-detect. |
| **Preferred internet source** | **TMDB** (default) or **OMDb**. |
| **TMDB API key** | Free key from [themoviedb.org](https://www.themoviedb.org/). Accepts a v3 key or a JWT (`eyJ…`). |
| **OMDb API key** | Free key from [omdbapi.com](https://www.omdbapi.com/). |

Keys and the enable flag round-trip with Settings → About → **Export / Import** (D45).

---

## Context menu

Shown only on **folders** and **video files** (not `.txt` / `.json` / random documents). Remotes (`mfe-remote://`) are skipped.

| Command | What it does |
| ------- | ------------ |
| **Extract from Plex Media Server** | Fill items that do **not** already have metadata. Folders walk every video inside. |
| **Download from Internet** | Same skip-if-present rule. Uses TMDB or OMDb (and the preferred source). |
| **Update** | Refresh items that already have metadata from their stored source (Plex vs internet). Missing items are extracted from Plex. |
| **Clear** | Remove this app’s metadata + cover streams. Folders walk every video inside. |
| **Change cover…** | Single item only. Pick a poster (does **not** change Plex’s own selected poster). |
| **Mark as Watched** | Toggles to **Mark as Unwatched** when the selection is already watched. Needs stored metadata. |

Status-bar progress shows while a batch runs; **Cancel** stops between items.

### Folder walks

Right-click a show or movie folder and the command includes every video underneath (cap 20 000).

**Shows vs movies** are detected from names and children (`S01E02`, `1x09`, `Season 01`, a year in the title, …). That is almost always enough. If a yearless folder could be either, a **Movie or TV show?** dialog asks once.

| Item | What is stored |
| ---- | -------------- |
| Show folder (`Breaking Bad`) | Show metadata + **portrait** cover (folder icon becomes the poster). Landscape stills / backdrops are skipped |
| Episode file | Episode metadata only. Icon stays the extracted `!VIDTHUMB_CACHE` thumb |
| Movie file or movie folder | Movie metadata + cover |

Season / `Specials` folders are not title cards; the parent show folder is. Generic dump names (`Movies`, `TV`, `Downloads`, …) are not written as title cards.

`media_metadata_container` is set on the **library folder** (the parent of the show folders, e.g. `TV Shows`) and on the show folder itself so Watched / Genre filters appear in both places.

**Video extensions:** `.mp4` `.mkv` `.webm` `.avi` `.divx` `.mov` `.wmv` `.m4v` `.mpg` `.mpeg` `.ts` `.m2ts` `.vob`.

---

## Preview

When the selected file or folder has streams (or you are inside a show/movie folder with no file selected — the current folder is the preview target):

1. **Hero** — poster + title, year / SxxExx / show name. Click the poster for a fullscreen view of the **stored** image (not a web URL).
2. **Change cover** and **Mark as Watched** under the title.
3. **Player** (if it is a video). Hero and player stay above the metadata; fields never overlay the still.
4. **Details** — language, country, genres (pills), directors, actors, ratings (source mark + score: Plex, Plex audience, TMDB, IMDb, Rotten Tomatoes, Metacritic; tooltip is the name), synopsis. Field values use the same boxed rows as file metadata; genres stay pills.
5. **Media / File tabs** — when both movie/TV details and extracted file metadata (duration, codec, …) exist, they share a tab strip under the player. One source only: no tabs.

Cover height is the setting above.

---

## Change cover

Lists posters from:

1. The cover already stored on the item (**Current**)
2. **Plex** — files in the local Metadata bundle, plus HTTP `/library/metadata/{id}/posters` if the server is up
3. **TMDB** — `/movie|tv/{id}/images` (needs a TMDB key)

Tiles are ordered **largest pixel size first**, with `width×height` on each cell, so the first tile is the best resolution. **Use this cover** applies that full image to this app’s thumbnail stream only.

Plex does not need to be running for local bundle posters. The on-disk layout is `Metadata/Movies/{first hex digit}/{rest of hash}.bundle` (same idea for TV).

---

## Watched, genre, and the toolbar

`watched` is a field on the item’s JSON. Extract / Download / Update **keep** it.

**Mark as Watched** (menu or preview) only changes items that already have metadata.

When metadata is written, `media_metadata_container` is set on the library folder (parent of show/movie title folders) and on the title folder. **Only then** does that folder’s toolbar show:

| Control | Values |
| ------- | ------ |
| **Watched** | All / Unwatched / Watched |
| **Genre** | All genres, plus every genre found on items in **this** folder |

Filters are session-only (they reset when you leave the folder). Items without metadata count as unwatched and have no genre.

Folders you tagged **before** this container flag existed will not show the toolbar until you **Update** the folder once (or add metadata to one new title).

---

## Plex vs internet

**Plex** is the best source if the library is already matched:

- Uses the local HTTP API when Plex Media Server is running (token from `Preferences.xml` unless you set one).
- If PMS is **not** running, extract still reads the library **SQLite** and poster files on disk.
- Episode extract writes **episode** text metadata; the **show** poster goes on the show folder, not on the episode file.
- The Plex token is **not** sent to `plex.tv` CDN hosts.

**TMDB / OMDb** need an API key. Names are parsed from the file or folder (`The.Matrix.1999.mkv`, `Show.S01E02.mkv`, `1x09`, …).

### API limits

Free TMDB and OMDb keys are capped (OMDb about **1,000/day**; TMDB also has a short **burst** limit). When a limit is hit, the batch **stops** and a dialog explains why. Items already written are kept. Wait and retry, or continue tomorrow.

---

## Where it is stored (D2)

No `.nfo`, no `folder.jpg` written by this app, nothing under `userData` for the library itself.

| Stream | On | Contents |
| ------ | -- | -------- |
| `media_metadata` | Video file or title folder | JSON (title, year, genres, cast, ratings, `watched`, source, …). Episodes include `season` / `episode` / `showTitle`. |
| `media_metadata_thumbnail` | Movie file, movie folder, or **show folder** | Cover image bytes. **Not** written on episode files. |
| `media_metadata_container` | Library folder (parent of show folders) and the show/movie folder | Small JSON flag so the toolbar can appear |

Streams ride with the file on NTFS copy/move. They do **not** survive a copy to FAT/exFAT/network shares that strip ADS. Explorer still opens the video as usual — it ignores these names.

Clear removes the two item streams. The container flag is left in place if siblings still have metadata.

You can inspect or delete the streams in **Alternate streams…** ([ADS.md](ADS.md)).

---

## JSON shape (item stream)

```json
{
  "version": 1,
  "source": "plex",
  "sourceId": "42",
  "kind": "movie",
  "title": "Heat",
  "year": 1995,
  "genres": ["Crime", "Drama"],
  "synopsis": "…",
  "directors": ["Michael Mann"],
  "actors": ["Al Pacino", "Robert De Niro"],
  "ratings": [{ "source": "Plex", "value": 7.6, "max": 10 }],
  "fetchedAt": "2026-08-17T00:00:00.000Z",
  "watched": false
}
```

`kind` is `movie` | `show` | `episode`. Episodes may include `season`, `episode`, `showTitle`. `source` is `plex` | `tmdb` | `omdb`.

---

## What this is not

- Not a Plex client (no playback through PMS, no writing back Plex’s chosen poster).
- Not a scraper that drops files into your library folders.
- Not available on Linux / non-NTFS (soft-fail; no streams).
- Not applied to FTP/SFTP remotes.

---

## Related code

| Area | Path |
| ---- | ---- |
| Shared parse / ADS names | `src/shared/mediaMetadata.ts` |
| Settings schema | `src/shared/schemas/mediaMetadata.ts` |
| Main batch + IPC | `src/main/mediaMetadata/` |
| Preview chrome | `src/renderer/components/MediaMetadataPreview.tsx` |
| Cover picker | `src/renderer/components/CoverPickerDialog.tsx` |
| Toolbar filters | `src/renderer/components/MediaLibraryToolbar.tsx` |
