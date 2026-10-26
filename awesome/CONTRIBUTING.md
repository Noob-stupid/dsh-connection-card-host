# Contributing to the card list

Two kinds of PRs are welcome here:

- **A card** — a package with a `dshCard` manifest (see [`docs/card-protocol.md`](../docs/card-protocol.md)).
- **A plugin that works as a card** — an ordinary DSH plugin that mounts cleanly on a connection.
  If it has a client half, say what renders.

## How to submit

1. Fork this repository.
2. Add **one row** to the right table in [`README.md`](README.md) (and, if you can, the Chinese
   twin in [`README.zh.md`](README.zh.md) — a maintainer will mirror it otherwise).
3. Fill in the evidence below.
4. Open a PR titled `list: <name>`.

## The row format

Cards (write it into `## Community cards`):

```md
| **Name** (`package-name-or-repo`) | One sentence: what it does for the peer. | `read_resource` / `write_resource` | `event_a`, `event_b` |
```

Plugins used as cards (`## Card-adapter plugins`):

```md
| [`repo-or-package`](https://…) | One sentence: what it brings to the connection. | ✅ mounts · UI captured · N slots |
```

Status column — use the strongest claim you can actually back:

| You write | You must have |
|---|---|
| ✅ mounts | The panel shows it in the card list and it loads |
| ✅ UI captured | The row in `client-debug.log` says `[ui-capture] … 捕获到 N 条槽位注册` (N > 0) |
| ✅ rendered | You saw the element on screen, not just a successful capture |
| ⚠️ partial | Say **what** fails — e.g. "renders, but the settings drawer errors" |
| ❌ refused | Paste the panel's refusal text; it names the missing capability |

## Evidence (required)

A PR without evidence will be asked for it and then closed. Paste, at minimum:

```
DSH version        : (from the panel's About, or `dsh --version`)
How you mounted it : package name / repo URL / local dir
What the panel says: (the card row, or the refusal text — verbatim)
```

If your plugin has a UI half, also paste the line from `client-debug.log`:

```
[ui-capture] <instance-id>：捕获到 N 条槽位注册（来源 <plugin-id>）
```

## What gets rejected

- **"Works" with nothing behind it.** We list evidence, not claims.
- **Global UI** (sidebar / layout / theme replacements). Those belong to the app, not to a
  connection; the candidate list marks them `global` and the list will mark them the same.
- **Plugins whose host half needs services this plugin does not provide** — see
  [Known incompatible](README.md#known-incompatible) for the pattern. They can still be listed
  there, with the reason, and that is a useful contribution too.
- **Machine-specific paths or private links** in the row.

## Housekeeping

- **The source of truth is `awesome/README.md` / `awesome/README.zh.md`.** The main `README.md`
  carries a **collapsed copy** of the same tables (inside a `<details>` block) so people can read the
  list without leaving the page. Edit **this folder**, not that copy — a maintainer refreshes the
  copy after merging. Two copies is a drift risk; this is the rule that keeps it from drifting.
- One row per PR keeps review cheap and history readable.
- Chinese and English rows say the same thing. Do not let one drift.
- If your entry later breaks, a PR that **downgrades the status** is as welcome as the original one.
  An honest ⚠️ is worth more than a stale ✅.
