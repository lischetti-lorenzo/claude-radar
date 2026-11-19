# Claude Radar

A floating macOS widget (top-right corner of your screen) plus a local web dashboard that shows what all your
**Claude Code** agents are doing — across every VS Code window and project — at a glance.

- See which agents are **working**, which ones are **asking you something**, which need **permission**, and which are **done**.
- Switch between projects with **‹ ›**; each project shows its active agents.
- Questions (`AskUserQuestion`), permission prompts and plans waiting for approval are shown inline, with all their options.
- Every agent gets its own color and shows the project, session name, git branch, current tool and elapsed time.
- Height-limited widget so it never takes over your screen; open the full dashboard with one click.
- Native macOS notifications when an agent asks something or finishes.

## Requirements

- macOS (the server and dashboard also work on Linux/Windows; the widget is tuned for macOS)
- Node.js 18+
- Claude Code CLI

## Installation

```bash
git clone <this-repo> claude-radar
cd claude-radar
npm install       # downloads Electron
npm run setup     # adds the hooks to ~/.claude/settings.json (a backup is created first)
npm start         # opens the widget
```

Claude sessions that were already running show up once you restart them.

## Usage

| Action | How |
| --- | --- |
| Switch project | **‹ ›** buttons or the arrow keys. Yellow dots mark projects with pending questions. |
| Open a project in VS Code | Click an agent card |
| Full dashboard | **⤢** button, or open <http://127.0.0.1:7337>. Cards of each project are shown side by side; switch to a wrapping grid with the layout toggle next to the search box |
| Collapse the widget | **–** button |
| Settings (notifications, sound, launch at login, reset position) | **⋯** button, or right-click ◉ in the menu bar |
| Show / hide the widget | **⌘⌥⇧R**, or click ◉ in the menu bar |
| Move the widget | Drag it by the top bar (the position is remembered) |

When an agent asks you something, the widget automatically jumps to that project.
To give a session a nice name, use `/rename` inside Claude Code; otherwise your first prompt is used.

## How it works

Claude Code runs [hooks](https://docs.claude.com/en/docs/claude-code/hooks) on `SessionStart`, `UserPromptSubmit`,
`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `PreCompact` and `SessionEnd`.
Each hook pipes its JSON payload with `curl` to a local server on `127.0.0.1:7337`, which keeps the state of every
session and streams it (Server-Sent Events) to the widget and the dashboard.

- If the widget isn't running, the `curl` call fails silently and Claude Code keeps working normally.
- Projects are grouped by git repository. Worktrees are resolved to their main repo, and nested repos
  (e.g. `app/web`) are grouped under the outermost repo.
- Session names and final messages are read from the session transcript.
- The server only listens on localhost and rejects requests with a non-local `Host` header.

```
src/server.js          local HTTP server: hook ingestion, state, SSE, "open in VS Code"
src/main.js            Electron app: floating window, menu bar item, notifications
src/preload.js         bridge between the widget page and Electron
public/widget.html     floating widget UI
public/dashboard.html  full dashboard UI
public/shared.js       helpers shared by both UIs
scripts/               hook installer/uninstaller and demo simulator
```

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Start the widget (also starts the server) |
| `npm run server` | Run only the server + dashboard, without the widget |
| `npm run setup` | Install the Claude Code hooks |
| `npm run uninstall-hooks` | Remove the hooks (leaves the rest of your settings untouched) |
| `npm run demo` | Load fake agents to preview the UI (`npm run demo -- --live` for an animated one) |

State and config are stored in `~/.claude-radar/`. Set the `RADAR_PORT` environment variable to change the port
(re-run `npm run setup` afterwards).

## Known limitations

- Claude Code doesn't fire a hook when you interrupt it with Esc, so an interrupted agent may keep showing
  "Working" until your next prompt. Agents with no activity for 5+ minutes are flagged as "no signal".
