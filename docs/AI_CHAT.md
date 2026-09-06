# Ask AI chat

**Status:** shipped with Media Metadata starters · Scripting and AI must both be enabled · Decision **D51** (privacy) · Windows / all platforms with AI configured

A reusable **ChatGPT-style** window for multi-turn Markdown Q&A. Features open it with a **starter** (seeded system + user message). History lives on this PC under `userData/ai-chats/` — not in settings export.

**Parked (not implementing now):** broader document Ask AI + explicit file-share consent (chat-only; D51 script privacy unchanged; history stays readable when AI is off) — [plans/AI_SEMANTIC_WORKBENCH.md](plans/AI_SEMANTIC_WORKBENCH.md).

## Open the window

- Toolbar **Ask AI** (when Scripting + AI are on; optional via Settings).
- **Media Metadata → Ask AI…** (context menu on a single movie/show/season/episode with stored metadata) — first built-in starter set.
- Later: Help / how-to starters can call the same `aiChat:startFromStarter` IPC with docs URLs in the prompt text (still no local paths).

Gates: `settings.scripts.enabled` **and** `settings.ai.enabled` (same as script Generate). Media starters also need Media Metadata enabled.

## Layout

Peer `BrowserWindow` of the explorer (**no parent** — same as Preview / Properties): OS title bar, maximize / close, move / resize, and free placement on another display. Bounds in `settings.aiChatWindowBounds` (restored on reopen if still on a connected screen; stripped on settings export).

**Toolbar:** **Ask AI** (after Script Manager) when Scripting and AI are both on. Hide via Settings → Scripting and AI → **Show AI toolbar button** (`ai.showToolbarButton`, default on).

| Region | Role |
| ------ | ---- |
| Left top | **Folders** tree (expand/collapse, nested subfolders). Defaults **Media**, **General**, **Help** are normal folders — rename, rearrange, nest, or delete. Drag a folder by the **edges** to reorder among siblings, **center** to nest under another; drop on empty tree area for root. |
| Left bottom | **Chats** in the selected folder (and its subtree), newest first. Drag a chat onto a folder to move it. Right-click rename / delete. |
| Right | Thread (Markdown for AI replies) + composer for follow-ups |

Not a single-shot dialog: after the starter reply you can keep chatting in that conversation.

**Splitters:** Drag the vertical bar between the sidebar and thread, or the horizontal bar between **Folders** and **Chats**. Width and split ratio persist in `userData/ai-chats/index.json` (not settings export). On reopen, the last folder, chat, expanded folder branches, sidebar width, and folders/chats split restore from the same store.

**Conversation anatomy**

```text
Conversation
├─ Source context (strip under title) — supplied by MFE, e.g. show title · Show
├─ Words actually written by the user (and starter questions)
└─ AI responses
```

Media starters put title/year/kind in the **system** message (and the source-context strip). The first **user** bubble is only the question text — never a metadata dump. Future document/file starters can reuse the same strip pattern.

## Privacy (D51)

- Starters and follow-ups must not include absolute paths, folder listings, or file bytes.
- Media starters send **title / year / kind / season / episode / show title / genres** only (from NTFS ADS metadata).
- Cloud providers: first use may ask you to acknowledge that conversation text may leave the machine (same ack flag as script Generate). Local providers skip that.
- Chat history is machine-local (`userData/ai-chats/index.json`). API keys stay in `ai-secrets.json`.

## IPC (summary)

| Channel | Role |
| ------- | ---- |
| `aiChat:open` | Open / focus the window |
| `aiChat:snapshot` | Topics + conversation list + UI chrome |
| `aiChat:createTopic` / `renameTopic` / `moveTopic` / `deleteTopic` | Folder CRUD (all folders editable; Media/Help keys recreated lazily for starters if deleted) |
| `aiChat:createConversation` / `rename` / `move` / `delete` / `getConversation` | Chats |
| `aiChat:sendMessage` | User follow-up → model → append assistant Markdown |
| `aiChat:startFromStarter` | Create chat under a system topic, seed messages, complete once |
| `aiChat:setUi` | Remember sidebar width / split / last selection / expanded folder branches |
| `mediaMetadata:askAi` | `{ path, queryId }` → build media prompts in main → `startFromStarter` |

Event `ai-chat-focus` tells the window which conversation to show after a starter.

Full tables: [IPC_CONTRACT.md](IPC_CONTRACT.md).

## Media starters

See [MEDIA_METADATA.md](MEDIA_METADATA.md) — Ask AI. Four prompts per kind (movie / show / season / episode), spoiler-safe vs full spoilers.
