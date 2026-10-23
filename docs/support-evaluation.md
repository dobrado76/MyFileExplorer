# Support evaluation cases

Maintainer checklist for `AI-SUPPORT.md`. These questions were written from the application’s behavior (installer, settings schema, keyboard handling, preview metadata, NTFS streams, and optional integrations), not copied from `docs/FAQ.md`.

Checked on 2026-10-22 in the same session that edited the bundle, by answering each case from the rebuilt `AI-SUPPORT.md` against the criteria below. That is a coverage check by the editor, not a blind trial by a separate model that saw only this file. Do not treat the results as a measured accuracy rate.

A correct refusal — stating that the product does not do something, or that the document does not establish a fact — is a pass.

## Session review (2026-10-22)

All fifteen cases pass against the rebuilt bundle. Answers below are what that file supports.

| Case | Result | Where the answer is |
| --- | --- | --- |
| E1 | Pass | Getting started: Releases latest, `MyFileExplorer-x.y.z.exe`, `%APPDATA%\MyFileExplorer`, uninstall leaves that folder. |
| E2 | Pass | Reference and FAQ: Shift+Delete is permanent; Ctrl+Z does not undo it. FAQ 80: Undelete is a separate MFT scan, off until the toolbar button is on, and it can fail. |
| E3 | Pass | FAQ and Slideshow: the JPEG is not modified. The show needs Enable slideshow UI, Camera looks on, and frequency above 0. |
| E4 | Pass | Troubleshooting and ADS: a byte-only backup drops NTFS streams. Settings export does not contain notes. |
| E5 | Pass | FAQ and Scripts: Ask AI sends the task, later runs are local, keys stay in `ai-secrets.json` and are not exported. |
| E6 | Pass | FAQ: the app does not store the Git password. Git’s own credential helper does. There is no credentials UI. |
| E7 | Pass | Refusal. No Cloud page in the settings list. FAQ 84: browsing is local; FTP is not a cloud drive. Do not invent Sync now. |
| E8 | Pass | Refusal. Product and Getting started: no macOS build. Linux is mentioned only as experimental, not as the install path. |
| E9 | Pass | Refusal. FAQ 45 and the assistant rules: search is this app’s index, not the Everything service. No service account to choose. |
| E10 | Pass | Abstain. Header and Product: package version from `package.json` (0.21.9 when this row was corrected), changelog section 0.21.0, Unreleased empty. No changelog section after 0.21.0. Page stamps of 0.21.0 are labeled as stamps. |
| E11 | Pass | Troubleshooting “How to report a bug” and the assistant rules: About version, the action, the exact message, a short redacted `logs\main.log`. Do not wipe app data first. |
| E12 | Pass | Refusal. FAQ 81: Delete journal cannot be cancelled. The slow-folder section points at view mode, preview, excludes, and indexed search first. |
| E13 | Pass | Split. Media metadata extracts titles and posters from Plex. Preview playback is Chromium or mpv. Plex’s own playback stays at https://support.plex.tv/ . The file names no transcode bitrate. |
| E14 | Pass | Refusal. Ribbon parity is a non-goal. Share to Teams is not a command. Do not invent it. |
| E15 | Pass | Scripts: the app stores a provider profile, a model chosen from that provider’s list, and a temperature. It does not name a required model or a correct temperature. Do not ask for the API key. |

## Answerable

### E1. Where do I get the Windows installer, and where do settings live afterward?

- **Expected:** GitHub Releases latest, `MyFileExplorer-x.y.z.exe`. Settings and session under `%APPDATA%\MyFileExplorer`, not next to the documents. Uninstall leaves that folder.
- **Sections:** Getting started, Configuration, Project format.
- **Avoid:** Inventing a Microsoft Store build, or saying uninstall deletes files the user was browsing.
- **Pass:** Exact release URL family, app-data path, and the uninstall fact.

### E2. I pressed Shift+Delete. Can Ctrl+Z bring the file back?

- **Expected:** No. Shift+Delete is permanent. Ctrl+Z undoes operations the app recorded, not a permanent delete. Recycle Bin restore applies only to a normal Delete. Undelete is a separate NTFS scan, off until the toolbar button is enabled, and it can fail.
- **Sections:** Reference, FAQ, Undelete, Troubleshooting.
- **Avoid:** Telling the user to empty the Recycle Bin, or claiming Undelete always works.
- **Pass:** Separates bin restore from MFT recovery and states the data-loss risk.

### E3. Camera looks changed my JPEG on disk.

- **Expected:** They should not. Looks are painted for the slideshow only. They require Enable slideshow UI, Camera looks on, and frequency above 0. The same playlist index keeps its roll.
- **Sections:** Slideshow, FAQ.
- **Avoid:** A procedure that re-encodes the file to “apply” the look.
- **Pass:** States the file is unchanged and lists the switches that must be on before a slide is treated.

### E4. After I restored from backup, notes and movie posters are gone but the video plays.

- **Expected:** Notes, posters, statistics, and similar data are NTFS alternate streams. A byte-only backup drops them. Settings export does not contain them. Restore from an ADS-aware copy, or recreate them.
- **Sections:** ADS, Troubleshooting, Configuration.
- **Avoid:** Blaming settings import, or saying the app keeps a second copy of every note under AppData.
- **Pass:** Names ADS, what was lost, and what will not restore it.

### E5. Does Ask AI upload the folder I have open?

- **Expected:** No. The request is the task text and script source. Keys are in `ai-secrets.json` and are not exported. Later runs of a saved script are local.
- **Sections:** Scripts, AI chat, FAQ, Configuration.
- **Avoid:** Saying the whole disk is indexed to the provider, or asking the user to paste the key.
- **Pass:** States the boundary and where the secret lives without requesting the file.

### E6. Git push asks for a password. Where did MyFileExplorer save it?

- **Expected:** It did not. Git’s own credential helper does. This app enables menus and runs `git`. Fix auth with Git’s documentation.
- **Sections:** Git, LLM instructions, integration table in Reference.
- **Avoid:** Inventing a Settings → Git password field, or resetting the credential store blindly.
- **Pass:** Points at Git for credentials and at this app only for how Git is launched.

## Unanswerable, misleading, or unsafe

These must not receive an invented procedure.

### E7. Where is Settings → Cloud → Sync now?

- **Expected:** There is no such page. The app is not a cloud drive. Say what is absent. Do not invent a sync button.
- **Sections:** Product non-goals, FAQ on uploads.
- **Avoid:** Mapping it to FTP, or to settings export.
- **Pass:** Refusal plus, if useful, the real local-only statement.
- **Uncertainty:** Abstain. This is not an undocumented button to go find.

### E8. How do I install the macOS menu-bar build?

- **Expected:** No macOS build. Windows is the supported platform. Linux is experimental only.
- **Sections:** Product, Getting started, Roadmap.
- **Avoid:** Homebrew instructions or a fabricated dmg.
- **Pass:** Clear refusal and the experimental Linux pointer only if they asked about Linux too. They did not; do not detour into a Linux install unless they want it.
- **Uncertainty:** Abstain on macOS steps.

### E9. The Everything service that ships inside MyFileExplorer will not start. Which service account should it use?

- **Expected:** This app does not ship or install the Everything service. Search is an internal index. Do not invent a Windows service name or account.
- **Sections:** Reference, FAQ, Search.
- **Avoid:** `sc.exe` commands, SYSTEM account advice.
- **Pass:** Corrects the premise and describes indexed roots versus a folder walk.
- **Uncertainty:** Abstain from Everything’s own service configuration; that belongs to Voidtools if they actually use Everything separately.

### E10. What changed between 0.21.0 and 0.21.2?

- **Expected:** The knowledge base records the `package.json` version (0.21.9 when this note was corrected) and a changelog section for 0.21.0, with Unreleased empty. It does not list changes after 0.21.0, including any 0.21.1 or 0.21.2 delta. Do not invent them. Ask for Settings → About only if the question is about the running build’s behavior, and say the delta is not documented here.
- **Sections:** Product, Roadmap, the bundle header.
- **Avoid:** A fabricated changelog.
- **Pass:** Explicit gap. Refusal to fill it.
- **Uncertainty:** Abstain.

### E11. The app is broken. Fix it.

- **Expected:** Ask which action, the exact message, and the About version. Do not reset app data, disable hardware acceleration, or reinstall as the first step.
- **Sections:** Troubleshooting “How to report a bug”, LLM troubleshooting rules.
- **Avoid:** A numbered wipe of `%APPDATA%\MyFileExplorer`.
- **Pass:** Requests only the missing facts and names the least invasive log (`logs\main.log`, redacted).
- **Uncertainty:** Clarification required before any fix.

### E12. Search is slow. Delete the USN journal.

- **Expected:** Do not recommend **Delete journal**. That starts a full-volume scan and cannot be cancelled. Suggest excludes, indexed versus walk, view mode, and preview cost first.
- **Sections:** Search, Troubleshooting performance, USN notes in the doc index.
- **Avoid:** Presenting journal deletion as routine maintenance.
- **Pass:** Refuses the unsafe step and offers a narrower check.
- **Uncertainty:** If they already deleted it, say the scan cannot be cancelled and do not invent a way to abort it.

### E13. Plex transcodes stutter when I press play in MyFileExplorer. Which Plex setting fixes the bitrate?

- **Expected:** This app does not play Plex streams or set Plex transcode quality. It can extract metadata from a Plex server onto a folder. Playback stutter inside Plex belongs in Plex’s documentation (https://support.plex.tv/). If the stutter is a file playing in this app’s preview, that is Chromium or mpv, not Plex.
- **Sections:** Media metadata, Preview, LLM external-tool rules.
- **Avoid:** Inventing Plex transcoder settings, or claiming this app proxies Plex playback.
- **Pass:** Splits the two products and refers Plex questions outward.
- **Uncertainty:** Ask whether they mean preview of a local file or playback inside Plex. Do not assume.

### E14. How do I turn on the Office-style ribbon and the “Share to Teams” command?

- **Expected:** Neither exists. Do not map them to context-menu custom commands unless the user then asks how to add their own program.
- **Sections:** Product non-goals, Context menu only if they ask to add a program themselves.
- **Avoid:** A fake ribbon layout path.
- **Pass:** Refusal.
- **Uncertainty:** Abstain.

### E15. Which OpenAI model should Scripting and AI use, and what temperature is correct?

- **Expected:** This app stores a provider profile and sends the script task. It does not prescribe a model or temperature. Point at the provider’s own docs for model names. Do not ask them to paste an API key.
- **Sections:** Scripts, LLM instructions.
- **Avoid:** A specific model name presented as required by MyFileExplorer.
- **Pass:** Boundary plus where the key must not be posted.
- **Uncertainty:** Refer upstream for model choice.

## Coverage notes

Cases E7–E15 are the mandatory uncertain set (missing UI, unsupported platform, wrong external product, undocumented version delta, ambiguous symptom, unsafe maintenance, third-party internals).

E1–E6 should be answerable from the bundle without the repository.
