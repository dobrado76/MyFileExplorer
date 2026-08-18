# Local scripts (D51)

**Status:** implemented (v0.8.2 development). Script Runner works with **no AI configured**. AI may **write** scripts; it **never reads** the user’s files.

Not File Automator ([FUTURE_IDEAS.md](FUTURE_IDEAS.md) item 1). Not D41 custom commands (`shell:exec` is detached, no captured stdout).

---

## Product rule

- Saved scripts rerun locally with zero AI calls.
- Generate / modify / repair send **task text and source code only** (plus OS + available runtimes + the CLI contract). Never selected names, paths, listings, or file bytes.
- Keys live in Electron `safeStorage` (`ai-secrets.json`), not `settings.json`.
- Library lives under `userData/scripts/` (D2) — never sidecars in browsed folders.

---

## CLI contract

Spawn is **executable + argument array** (`shell: false`).

- Folder: `script --root "<folder>" [--recursive] [--dry-run] [--param …]`
- Selection: `script --input-list "<utf8 manifest>" [--dry-run] [--param …]`

Large selections always go through a temp UTF-8 manifest (one path per line), deleted when the process exits.

Languages: PowerShell (`.ps1`), Python (`.py`), cmd (`.bat`/`.cmd` on Windows), bash (`.sh`). Interpreters are detected on PATH; optional overrides are Settings → AI → Script runner.

---

## Using scripts

1. Toolbar **Scripts** or context **Scripts → Manage Scripts…**
2. Write or paste source, set folder vs selection scope, Save.
3. **Run** / **Dry run** opens the execution dialog (live stdout/stderr, elapsed, Stop, copy output).
4. Context **Scripts >** lists eligible saved items (scope, optional category, extension / min-selection filters).
5. First run: acknowledge that scripts run as you and can delete files. Destructive-looking source (`Remove-Item`, `os.remove`, `rm -rf`, `del`, …) shows a banner.

Declared dependencies are shown with **Copy install command** — the app never silently `pip install`.

---

## AI (optional)

Settings → **AI**:

- Enable AI (off = no outbound AI HTTP).
- Providers: OpenAI, OpenRouter, LM Studio, custom OpenAI-compatible base URL.
- Test / Refresh models uses `GET /v1/models` (no wasteful completion). The result fills a model dropdown and is cached on the provider (no keys).
- Default model, per-provider model, temperature, max tokens, preferred language. Switch providers or pick a cheaper model from the list — you do not type ids.

**Generate script with AI…** (Script Manager or context menu):

- Describe the task. Review/edit source. Save. Later runs are local.
- Generate / Modify / Ask AI to Fix show a dialog overlay (indeterminate bar + elapsed) while waiting.
- The source editor syntax-highlights PowerShell, Python, cmd, and bash.
- Local vs cloud indicator. Cloud first-use copy: task/script may go to the provider; files do not.
- **Modify** sends current source + instruction only.
- **Ask AI to Fix** (after a non-zero exit) asks first and lists the payload (source, exit code, stderr, OS/runtime). Optional path redaction. Never auto-sent.

No provider → **Open AI Settings**, not a hard error on the runner.

---

## Import / export

- Per-script `.mfescript` (JSON). Import warns that the file is untrusted.
- Settings export includes the script library (source yes) and AI provider metadata (keys no).
- External file references: tick **External file** and browse to a `.ps1`/`.py`/`.cmd`/`.sh`.
- **Revert** restores the previous managed source after an AI modify.

---

## Out of v1

Scheduler, plugin SDK, marketplace, node editor, IntelliSense/debugger, auto `pip install`, generation history, required categories, Miller columns, automatic elevation.
