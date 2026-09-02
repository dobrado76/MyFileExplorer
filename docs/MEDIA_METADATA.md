# Media metadata (D50)

**Status:** shipped in **v0.9.0**; **v0.15.0** adds Edit metadata, icon actions, and per-library Watched/Genre filter persistence · Decision **D50** · **Windows / NTFS only**

Opt-in movie and TV cards for a local library. Title, year, genres, cast, ratings, a watched flag, and a **portrait** poster live on the **file or folder** as NTFS alternate data streams — not as `.nfo` / `folder.jpg`, and not under `%APPDATA%`.

A first install stays a plain file manager. Nothing of this appears until you turn the feature on.

Locked choice: [DECISIONS.md](DECISIONS.md) **D50**. Streams: [ADS.md](ADS.md). Settings keys: [PROJECT_FORMAT.md](PROJECT_FORMAT.md). IPC: [IPC_CONTRACT.md](IPC_CONTRACT.md).

---

## At a glance

| You see | When |
| ------- | ---- |
| Context menu **Media Metadata** | Settings → Media Metadata is **on**, and the selection is a **folder** or a **video file** (not remotes) |
| Poster + title above the preview player | The selected item (or the current show/movie folder) has stored metadata |
| Poster as the folder icon | Movie and show **folders** use the stored cover (shrink-to-fit; XL icons only hide the folder name) |
| `S02E01` + episode title on tiles | Icon / thumbnail views, when episode metadata is stored and the icon-label setting is on |
| **Change cover** | Context menu (single item) or the link under the preview title |
| **Mark as Watched** / **Unwatched** | Context menu, and a button on the preview when metadata exists |
| Toolbar **Watched** + **Genre** | You are inside a folder marked as a media container |

Episode **files** keep `!VIDTHUMB_CACHE` strip thumbs — never the show poster. Details and List always show the real filename. The tooltip is always the filename.

---

## Turn it on

**Settings → Media Metadata → Enable** (`mediaMetadata.enabled`, default **off**).

| Setting | Purpose |
| ------- | ------- |
| **Cover art size** | Preview poster height, 56–240 px (default **120**). Width follows 2:3. |
| **Show season/episode and title on icon tiles** | On (default): icon views show `S02E01` and the episode title. Off: the filename. Details / List always use the filename. |
| **Mix folders and files in media libraries** | Off by default. On: in **icon/thumbnail** views only, a `media_metadata_container` folder is one A–Z tile list (covers sit next to movie files). List and Details follow Settings → Behavior → Folders first. |
| **Plex URL** | Local server, default `http://127.0.0.1:32400`. `localhost` is mapped to `127.0.0.1`. |
| **Plex token** | Optional override. If empty, the app reads it from Plex `Preferences.xml`. |
| **Plex data folder** | Optional override of the on-disk library (`Metadata` bundles + SQLite). Leave empty to auto-detect. |
| **Preferred internet source** | **TMDB** (default) or **OMDb**. |
| **TMDB API key** | Free key from [themoviedb.org](https://www.themoviedb.org/). Accepts a v3 key or a JWT (`eyJ…`). |
| **OMDb API key** | Free key from [omdbapi.com](https://www.omdbapi.com/). |

Keys and every flag above round-trip with Settings → About → **Export / Import** (D45).

---

## Commands

Shown only on **folders** and **video files**. Remotes (`mfe-remote://`) are skipped.

| Command | What it does |
| ------- | ------------ |
| **Extract from Plex Media Server** | Fill items that do **not** already have metadata **and a cover** (episodes: metadata only). Plex maps each file to one library item and copies the library poster. |
| **Download from Internet** | Same skip-if-present rule (retry if the cover is missing). Uses TMDB or OMDb (and the preferred source). |
| **Update** | Refresh items that already have metadata from their stored source (Plex vs internet). Missing items are extracted from Plex. Internet items reuse the stored id (no second title ask). |
| **Clear** | Remove this app’s metadata + cover streams. Folders walk every video inside. |
| **Consolidate subtitles** | Copy the first English subtitle next to each video, then Recycle the `Subs` / `Subtitles` tree. Confirms first. |
| **Edit metadata…** | Single item only. Dialog to fix title, year, language, country, genres, directors, actors, synopsis, watched, and (episodes) season / episode / show title. Does not edit ratings or cover (use **Change cover…**). Preserves source id / kind / ratings. With no card yet, saves a **manual** entry. Also on the preview hero and media-card hover pencil. |
| **Change cover…** | Single item only. Pick a poster from Plex / TMDB, **browse for your own image**, or keep the current cover. Does **not** change Plex’s own selected poster. |
| **Mark as Watched** | Toggles to **Mark as Unwatched** when the selection is already watched. Needs stored metadata. |

Status-bar progress shows while a batch runs; **Cancel** stops between items.

If Plex or the internet finds **no title**, a dialog opens with the filename (no extension) in a **Search as** box. Edit it — drop a sort-only number (`Babylon 5 - 5 - A Call to Arms` → `Babylon 5 - A Call to Arms`), put the year in parentheses — and **Search** again. **Cancel** skips that item; other misses still get their own dialog.

---

## How a library is walked

Right-click a show or movie folder and the command includes every video underneath (cap 20 000). Right-click a library folder (`Series`, `TV Shows`, …) and each **title folder** gets a show/movie card + cover first, then the episode files.

| Item | What is stored |
| ---- | -------------- |
| Show folder (`Breaking Bad`) | Show metadata + **portrait** cover (folder icon becomes the poster). Landscape stills / backdrops are skipped |
| Episode file | Episode JSON only. Icon stays `!VIDTHUMB_CACHE`. Preview uses the show cover when the episode has none |
| Movie file or movie folder | Movie metadata + cover |
| CD-split movie folder | The **folder** is the movie (`[Part 1]` / `CD1` / `Disc 1` / `1of2`). Part files are skipped and cleared |

Season / `Specials` folders are not title cards; the parent show folder is. Generic dump names (`Movies`, `TV`, `Downloads`, …) are not written as title cards.

`media_metadata_container` is set on the **library folder** (the parent of the show folders) and on the show/movie folder itself so Watched / Genre filters appear in both places.

**Video extensions:** `.mp4` `.mkv` `.webm` `.avi` `.divx` `.mov` `.wmv` `.m4v` `.mpg` `.mpeg` `.ts` `.m2ts` `.vob` `.flv` `.rmvb` `.rm`.

---

## Matching

Automation first. Dialogs only when the name is genuinely unclear.

**Show vs movie** is detected from names and children (`S01E02`, `1x09`, `Season 01`, a year in the title, a folder of CD parts, …). If a yearless folder could be either, **Movie or TV show?** asks once. Skip leaves that item.

**Same title, several movies** (Dune 1984 vs 2021, The Office US vs UK) is handled only on **Download from Internet** (and **Update** when the stored source is TMDB/OMDb):

| Situation | What happens |
| --------- | ------------ |
| One search hit, or the year in the name uniquely matches | Download proceeds |
| Only one result has that exact title (fuzzy extras ignored) | Download proceeds |
| Several results share the exact title and the year does not pick one | **Which title?** lists them (title + year + a short line). **Search as…** opens the same name box as a miss; Skip leaves that item |
| **Extract from Plex** | Never asks — Plex already maps the file to one library item |

**Filenames** are parsed from the file or folder (`The.Matrix.1999.mkv`, `Show.S01E02.mkv`, `1x09`, …). Scene tags and the trailing `-GROUP` (`x265-ION265`) are stripped; the show title is the text **before** `SxxExx`. Hyphenated titles (`Spider-Man`, `Catch-22`) stay intact.

A **Search as** (no match, or **Search as…** on **Which title?**) sends the typed name **as-is** — those scene tags are not stripped. A trailing `(1999)` is still used as the year. You can also paste a **TMDB** movie/TV URL or an **IMDb** title URL (OMDb uses that id); that skips search and fetches that title. A TMDB URL on an Extract from Plex miss downloads from the internet instead.

---

## Icon and list labels

| View | Episode with metadata | Movie / show folder with a cover |
| ---- | --------------------- | -------------------------------- |
| Icon / thumbnail | `S01E07` centered, episode title under it (not the show name / not `Untitled`). Off via **Show season/episode and title on icon tiles** → filename | Poster as the folder thumb. XL icons only hide the folder name |
| Details / List | Always the filename | Always the folder name |
| Tooltip | Always the filename | Always the folder name |

Season defaults to **1** when the stored episode has a number but no season (some Plex rows omit it).

---

## Preview

When the selected file or folder has streams — or you are inside a show/movie folder with **no file selected** (the current folder is the preview target):

1. **Show/movie folders — Media | Folder** — header tabs like Git | Folder (**Media** by default). **Media** = poster hero + cast/synopsis; **Folder** = directory / Calculate Statistics card (space map, largest files, …).
2. **Hero** (Media tab / media files) — poster + title, year / SxxExx / show name. Click the poster for a fullscreen view of the **stored** image (not a web URL).
3. Icon actions under the title (same glyphs as media-card hover): **Edit metadata…**, **Change cover**, **Mark as Watched** — labels are tooltips.
4. **Player** (if it is a video). Hero and player stay above the metadata; fields never overlay the still.
5. **Details** — language, country, genres (pills), directors, actors, ratings (source mark + score: Plex, Plex audience, TMDB, IMDb, Rotten Tomatoes, Metacritic; tooltip is the name), synopsis. Field values use the same boxed rows as file metadata; genres stay pills. Details are read-only — use **Edit metadata…** to change them.
6. **Media / File tabs** (episode and other media **files** only) — when both movie/TV details and extracted file metadata (duration, codec, …) exist, they share a tab strip under the player. One source only: no tabs. Folders use the header Media | Folder split instead.

Cover height is **Cover art size**.

---

## Change cover

Lists posters from:

1. The cover already stored on the item (**Current**)
2. **Plex** — files in the local Metadata bundle, plus HTTP `/library/metadata/{id}/posters` if the server is up
3. **TMDB** — `/movie|tv/{id}/images` (needs a TMDB key)

The dialog is a **fixed size**. The current cover (if any) appears immediately; Plex and TMDB posters **stream in** as their previews load so you can pick before the list is finished. Tiles stay **largest pixel size first**, with `width×height` on each cell. **Use this cover** reloads from that tile’s source (or the preview already shown) — it does not depend on a short-lived in-memory list.

Plex does not need to be running for local bundle posters. The on-disk layout is `Metadata/Movies/{first hex digit}/{rest of hash}.bundle` (same idea for TV).

---

## Watched and genre

`watched` is a field on the item’s JSON. Extract / Download / Update **keep** it.

**Mark as Watched** (menu or preview) only changes items that already have metadata.

When metadata is written, `media_metadata_container` is set on the library folder and on the title folder. **Only then** does that folder’s toolbar show:

| Control | Values |
| ------- | ------ |
| **Watched** | All / Unwatched / Watched |
| **Genre** | All genres, plus every genre found on items in **this** folder |

Filters are remembered **per media-library folder** in Settings (`mediaMetadata.libraryFilters`) and restored when you return to that folder. Items without metadata count as unwatched and have no genre. If a saved genre is no longer present in the folder, the genre filter clears for that visit.

Folders you tagged **before** this container flag existed will not show the toolbar until you **Update** the folder once (or add metadata to one new title).

---

## Consolidate subtitles

Some rips put English `.srt` files under `Season N/Subs/<same-name-as-the-video>/` instead of next to the `.mp4`. **Consolidate subtitles** walks from the selection (show, season, or library folder):

1. In each folder that has a sibling `Subs` / `Subtitles` / `Subtitle` / `Sub` (any case), match each video to `Subs/<video stem>/` or a flat `Subs/<stem>*.srt`.
2. Copy the first English-tagged subtitle (`.srt` before `.ass` / `.vtt` / …). If nothing is tagged English, use the only subtitle (or the only `.srt`) in that folder.
3. Write `{video stem}.srt` (or the picked extension) beside the video. Existing dest files are left alone.
4. After a folder-level run, send the Subs tree to the Recycle Bin (not a permanent delete). Selecting only some videos copies those matches and leaves Subs in place.

Confirm before it runs. Remotes are skipped. Walk cap is 20 000 folders; Subs trees are not walked as further roots.

---

## Plex vs internet

**Plex** is the best source if the library is already matched:

- Looks up the file in the local library **SQLite** first (path → rating key), then one HTTP metadata call if PMS is running.
- Poster comes from the on-disk Metadata bundle when present; HTTP thumbs are a fallback.
- Episode extract skips cover downloads (file icon stays `!VIDTHUMB_CACHE`).
- If PMS is **not** running, extract still reads SQLite and poster files on disk.
- Episode extract writes **episode** text metadata; the **show** poster goes on the show folder, not on the episode file.
- The Plex token is **not** sent to `plex.tv` CDN hosts.

**TMDB / OMDb** need an API key. Matching uses the parsed title (and year when present), or the typed **Search as** string. Same-title remakes use the **Which title?** list above.

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

Streams ride with the file on NTFS copy/move. They do **not** survive a copy to FAT/exFAT/network shares that strip ADS. Explorer still opens the video as usual — it ignores these names. Writing or clearing these streams restores the host file/folder NTFS times (including ChangeTime) so a sync tool should not treat the video as newly modified. Files already written before that restore cannot be rolled back.

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

`source` is `plex` | `tmdb` | `omdb` | `manual` (hand-built via **Edit metadata…** with no prior card).

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
| Shared parse / ADS names / title matching | `src/shared/mediaMetadata.ts` |
| Settings schema | `src/shared/schemas/mediaMetadata.ts` |
| Main batch + IPC | `src/main/mediaMetadata/` |
| Preview chrome | `src/renderer/components/MediaMetadataPreview.tsx` |
| Cover picker | `src/renderer/components/CoverPickerDialog.tsx` |
| Toolbar filters | `src/renderer/components/MediaLibraryToolbar.tsx` |
