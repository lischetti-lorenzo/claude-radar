# Claude Radar

A floating macOS widget (top-right corner of your screen) plus a local web dashboard that shows what all your
**Claude Code** agents are doing — across every VS Code window and project — at a glance.

- See which agents are **working**, which ones are **asking you something**, which need **permission**, and which are **done**.
- Switch between projects with **‹ ›**; each project shows its active agents.
- Questions (`AskUserQuestion`), permission prompts and plans waiting for approval are shown inline, with all their options.
- **Answer questions right from the widget or the dashboard**: pick an option (or type your own answer) and Claude continues.
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

### More than one Claude account

If you use several Claude accounts (each one is a `CLAUDE_CONFIG_DIR`, e.g. `alias claude-sb='CLAUDE_CONFIG_DIR="$HOME/.claude-sb" claude'`),
list them in `accounts.json` at the project root (git-ignored; copy `accounts.example.json`, or let `npm run setup` create it with just the default account). The default account
(`~/.claude`, the plain `claude` command) is always tracked, even if you leave it out:

```json
{
  "accounts": [
    { "name": "personal", "command": "claude",    "configDir": "~/.claude" },
    { "name": "trabajo",  "command": "claude-sb", "configDir": "~/.claude-sb" }
  ]
}
```

Then run `npm run setup` again (it installs the hooks in each account's `settings.json`) and restart Radar.
When more than one account is configured, every card shows which account the session belongs to.
`npm run uninstall-hooks` removes the hooks from every listed account.

## Usage

| Action | How |
| --- | --- |
| Switch project | **‹ ›** buttons or the arrow keys. Yellow dots mark projects with pending questions. |
| Answer a question | Pick the option(s) (or type another answer) and press **Enviar respuesta** — from the widget or the dashboard |
| Answer it in the terminal instead | **Responder en la terminal** on the question; Claude shows its usual prompt |
| Turn off answering from Radar | **⋯ → Responder preguntas desde Radar**, or the **Responder desde Radar** checkbox in the dashboard |
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
- `AskUserQuestion` has an extra `PreToolUse` hook that keeps its request open until you answer in Radar; the answer goes
  back to Claude as the tool's `answers` (via `updatedInput`). While Radar holds a question, the terminal shows the hook
  running instead of the question. Choose **Responder en la terminal** to get the normal prompt back; it also comes back
  automatically if Radar isn't running, the option is off, or nobody answers within an hour.
  If you installed the hooks before this feature existed, run `npm run setup` again.
- Only Radar's own pages can call its API (JSON requests with a local `Origin`), so a web page can't answer for you.
- Projects are grouped by git repository. Worktrees are resolved to their main repo, and nested repos
  (e.g. `app/web`) are grouped under the outermost repo.
- Session names and final messages are read from the session transcript.
- The hooks also send the PID of the Claude Code process. Claude runs every Bash command in a shell that sources its
  shell snapshot, as a child of that process, so Radar checks (`ps`, every 3 s) whether a session still has commands
  running. If Claude ends its turn while a command keeps running (`run_in_background`), the session stays
  **Working · En segundo plano** instead of "Done"; it turns "Done" when Claude finishes its next turn, or 15 s after the
  command exits if Claude doesn't pick it back up. Long foreground commands aren't flagged as "no signal" either.
  (macOS/Linux; hooks installed before this feature don't send the PID — run `npm run setup` again.)
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
  "Working" until your next prompt. Agents with no activity for 5+ minutes (and no command running) are flagged as "no signal".
- A command that never exits on its own (a dev server started in the background) keeps its session in "Working" until
  you stop it or send a new prompt.
