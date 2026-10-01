# dsh-connection-card-host

[中文](README.md) | **English**

> **Let your DSH sessions see each other, talk to each other, and share tools — without getting in each other's way.**

Running several DSH sessions at once (one researching, one coding, one running experiments)
is normal — but they're **isolated**: they can't see what the others are doing, and can't
hand conclusions over.

This plugin makes a **connection** a first-class object in DSH:
**sessions are nodes, a connection is the container, cards are connection-scoped plugins.**

<table>
<tr>
<td width="50%">

**In practice** (screen recording)

<img src="docs/assets/demo-drag-anchor.gif" alt="Dragging a connection line out from the anchor beside the composer" />

</td>
<td width="50%">

**Structure** (diagram)

<img src="docs/assets/demo-drag.svg" alt="Drag-to-connect structure: anchor → session row → rail" />

</td>
</tr>
</table>

<p align="center">
  <sub>Left: the real thing (<a href="docs/assets/demo-drag-anchor.mp4">source video</a>) · Right: the same action as a diagram, showing the toggle semantics</sub>
</p>

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Three layers: awareness / conventions / messaging](#three-layers-awareness--conventions--messaging)
- [Cards on a connection](#cards-on-a-connection)
- [Architecture at a glance](#architecture-at-a-glance)
- [Why it works this way](#why-it-works-this-way)
- [Where it saves](#where-it-saves)
- [Install](#install)
- [Writing a card](#writing-a-card)
- [Status](#status)

---

## What it does

| | |
|:---|:---|
| **See each other** | Look up **which files the other session is editing, how far its plan has got, what tools it last used** — collected automatically, no effort required from the other side |
| **Talk to each other** | Send a message with **one of three urgencies you choose**: notify only (no interruption) / queue / interject |
| **Share tools** | Mount **cards** on a connection: a card can provide tools to the sessions, even with tens of MB of real dependencies |
| **Shared premises** | A "convention box" holds what you agreed on: interfaces, units, naming, who owns what |
| **Stay out of the way** | Awareness is **pull-based** — zero cost unless the other side asks. Unrelated connections **never interrupt you** |

<p align="center">
  <img src="docs/assets/demo-permission.svg" width="680" alt="Line colour shows the permission in that direction: grey = read-only, blue = can suggest, orange = can write; the two ends can differ" />
</p>

---

## Quick start

1. **Connect**: hold the circle to the left of the composer (or the `…` on a session row)
   and drag it onto a row in the session list.

<table>
<tr>
<td width="50%">

**Drag from the anchor** (recording)

<img src="docs/assets/demo-drag-anchor.gif" alt="Dragging an arc out from the anchor beside the composer" />

</td>
<td width="50%">

**Drag from a session row → after connecting** (recording)

<img src="docs/assets/demo-drag-rail.gif" alt="Dragging from a session row; after release a rail appears with per-end permission dots" />

</td>
</tr>
</table>

<p align="center">
  <sub><a href="docs/assets/demo-drag-anchor.mp4">anchor source video</a> · <a href="docs/assets/demo-drag-rail.mp4">session-row source video</a></sub>
</p>

   - **Toggle semantics**: drop on an unconnected row = connect; drop on an **already
     connected** row = disconnect (the hover hint tells you which)
   - You can also pick two sessions from the "Connections" panel in the sidebar
2. **Done.** Both ends get one quiet notice (who you're connected to, what it enables) —
   **nobody is interrupted**.
3. Want more detail? Open "Connections" in the sidebar, or have the session call
   `connection_peer_work` itself.

Once connected, a **rail** appears beside the session rows, with a **coloured dot at each
end** — that's the permission for that direction:

<p align="center">
  <img src="docs/assets/shot-connections.png" width="620" alt="Connections panel: permissions are set per direction, and cards, awareness and conventions all live under the same connection" />
</p>

---

## Three layers: awareness / conventions / messaging

These are **separate**, because their costs differ enormously:

| Layer | Mechanism | Enters the other's context? | Forces the other to act? | Cost |
|:---|:---|:---|:---|:---|
| **A. Work state** | pull (the other asks) | only when it asks | ❌ no | **0** |
| **B. Convention box** | pull (the other asks) | only when it asks | ❌ no | **0** |
| **C. Messaging** | push (into its inbox) | **unconditionally** | ✅ **always** | every message |

**The key fact**: in DSH, delivering a message **forces the other session to run a turn** —
the agent loop has no "saw it but ignored it" state. So "talking" and "being aware" have to
be built separately: to make the other side **know**, use A/B; only to make it **act**, use C.

### A. Work state (automatic, zero cost)

Collected from runtime events — **it asks nothing extra of the model**:

```
【session-bd5ac1b1】
status: running a command (2s ago)
recently touched: water-boat/src/water.js
progress: turn 69 / step 39
```

### B. Convention box (explicit, zero cost)

What you agreed on: interface signatures, units, coordinate systems, naming, **who owns what**.
Editable in the panel; sessions read and write it with `connection_conventions` / `connection_declare`.

> **Why pull, not push**: pushing slowly fills the other's context, and most of it is
> never needed. Keeping it in a box that the other queries on demand costs zero.

### C. Messaging (three urgencies, **chosen by the sender**)

| Urgency | Under the hood | What the other sees |
|:---|:---|:---|
| `quiet` | `inject` | placed in context **without waking it** — it sees the message next time it works, **uninterrupted** |
| `normal` | `followup` | **queued** — it sees the message once it finishes what it's doing |
| `urgent` | `steer` | **interjected** — inserted into the turn it's **currently running**, read immediately |

`urgent` on an idle peer **degrades to queued** automatically (the next turn starts
immediately, so the effect is the same), and never fails.

> **The rule** (written into the tool description): interrupting has a cost — the other
> session has to drop its current line of thought. Most messages aren't urgent: default to
> `normal`, and use `urgent` only when it genuinely must change behaviour **right now**.

---

## Cards on a connection

**A card = a plugin mounted on a connection, with per-side visibility.**

| | DSH plugin | Card |
|:---|:---|:---|
| Mounted on | the whole DSH (profile) | **one connection** |
| Who can call it | every session | **only sessions on that connection** |
| Visibility | global | **per side**: both / A only / B only |
| Lifetime | DSH start/stop | mounted and unmounted with the connection |

<p align="center">
  <img src="docs/assets/demo-card-tool.svg" width="680" alt="A session uses one resident bridge tool to discover and call tools provided by cards, subject to visibility scope" />
</p>

### Cards can provide tools to sessions

Tools registered with `api.registerTool(name, fn)` inside a card are reachable by sessions
on that connection through **one** resident bridge tool:

```
connection_card_tool                                  ← the only resident one (1 schema)
  ├─ no `tool` argument → list the cards and tools visible to *your* side of this connection
  └─ with `tool`        → call it
```

**Why one bridge instead of one schema per tool**: the latter would make **every session**
pay a resident cost for every card tool, while cards are mounted and unmounted dynamically.
The bridge costs one schema, and it's the natural place to enforce visibility.

**Visibility actually blocks** (measured):

```
Side A can see the card      ✅
Side B cannot see it         ✅
Side B calls it anyway       → 「这张卡片只对 A 端可见（你在 B 端）」
```

### Cards can carry real dependencies

Measured: wrapping the parsing core of the community plugin `dsh-pdf` plus
**pdfjs-dist (33 MB)** as a card, installed under `$DSH_HOME/connection-cards/cards/`,
**without touching the DSH profile**. A session called it through the bridge and got real
parse results back.

### Install and update from the panel

<p align="center">
  <img src="docs/assets/shot-card-picker.png" width="620" alt="Card picker: built-in cards install in one click; you can also give a package name, a repo tgz URL or a local directory" />
</p>

- **Install**: package name / repo tgz URL / local directory → into our own directory,
  **no pnpm, no profile changes**
- **Update**: installed cards get a "check for updates" entry with three distinct states
  ```
  「检查更新」→「↑ 更新到 x.y.z」/「已是最新」/「无法检查」
  ```
  **"Couldn't check" is never shown as "up to date"** — that would be lying.

---

## Architecture at a glance

Three layers, with hard boundaries — each talks only to the one below:

```
┌─────────────────────────────────────────────────────────────┐
│  Card layer (connection-scoped plugins)                     │
│  Depends only on CardAPI; NEVER imports @deepseek-ai/*      │
│  → DSH upgrades don't affect cards; our CardAPI changes do  │
│    (guarded by a version declaration)                       │
├─────────────────────────────────────────────────────────────┤
│  Connection layer (this plugin)                             │
│  connections / permissions / awareness / conventions /      │
│  card host / message delivery                               │
│  → on a DSH upgrade, this is the only layer to change       │
├─────────────────────────────────────────────────────────────┤
│  DSH adapter layer (DSHAdapter + allowlist + audit)         │
│  the single exit point for all DSH interaction; we do not   │
│  rewrite DSH's transport, permissions or plugin system      │
└─────────────────────────────────────────────────────────────┘
```

### Permissions are **per direction**

One line, one dot at each end; the colour is the permission **for that direction** — the two
directions are independent, so you can have "A may send, B may only watch":

<p align="center">
  <img src="docs/assets/demo-permission.svg" width="640" alt="Line colour shows the permission in that direction: grey = read-only, blue = can suggest, orange = can write; the two ends can differ" />
</p>

**Read-only does not affect awareness**: work state and the convention box are both
**queried by the other side**, independent of permission. Lowering a permission takes effect
immediately; raising one requires confirmation from the side being granted it.

### How card tools reach a session

Tools registered by cards **do not each take a schema** — a session sees **one** resident
bridge, discovers on demand, calls on demand, and visibility is enforced at the bridge:

<p align="center">
  <img src="docs/assets/demo-card-tool.svg" width="640" alt="A session uses one resident bridge tool to discover and call tools provided by cards, subject to visibility scope" />
</p>

---

## Why it works this way

### 1. It doesn't rewrite DSH

We don't touch DSH's transport, permissions or plugin system, and cards are **not registered
into DSH's global loader**. All DSH interaction goes through an adapter layer, so a DSH
upgrade means **changing this one plugin**.

### 2. Automatic two-way mirroring — we turned it off

Early versions forwarded session content to the peer automatically. **Measurement said that
was wrong.** Three incidents:

1. An instruction the user gave to A was mirrored to B → **B treated it as its own task**
2. An assistant's progress report was mirrored → the peer treated it as a user instruction
3. An assistant's aside to the user was mirrored → the peer showed "received an execution
   request" and **actually ran a turn**

The peer's own numbers: **30 messages / 12,765 characters of mirrored traffic made up 77.8%
of its user-side characters, and not one of them produced a useful action.**

**So nothing is forwarded automatically any more.** Cross-session messaging is explicit;
awareness uses layers A and B.

### 3. Interrupting costs something

The old delivery policy was "if the peer is running, interject" — equivalent to treating
**every message as top priority**. Now the sender chooses the urgency, and the default is
to queue.

---

## Where it saves

| Item | Number | Notes |
|:---|:---|:---|
| **Awareness (layers A + B)** | **0 context** | pull-based; costs nothing unless the peer queries |
| **Card tools** | **1 resident schema** | instead of one per card tool |
| **Automatic mirroring** | **0 (disabled)** | measured at 77.8% useless content before it was turned off |
| **Unrelated connections** | **0 interruptions** | connecting doesn't wake anyone; unrelated sessions carry on |

**The one fixed cost**: this plugin's five `connection_*` tools cost roughly **1,700 tokens
resident**. (This can be reduced further — see [Status](#status).)

---

## Install

**This plugin is not on npm.** DSH's peer dependencies (`@deepseek-ai/dsh-client-runtime` and
friends) are not on the public registry, so `npm install` resolves peerDependencies from that
registry and necessarily fails (observed as `notarget ... @deepseek-ai/dsh-client-runtime`).
Install from GitHub instead:

```sh
# stable line (this repository, the public face)
dsh plugin --profile web add github:Noob-stupid/dsh-connection-card-host

# same thing, GitHub shorthand (the github: prefix is optional) — a slash means a GitHub repo
dsh plugin --profile web add Noob-stupid/dsh-connection-card-host

# pin a version: use the tgz attached to Releases (v1.0.0 is published)
dsh plugin --profile web add https://github.com/Noob-stupid/dsh-connection-card-host/releases/download/v1.0.0/dsh-external-dsh-connection-card-host-1.0.0.tgz

# the same tgz, downloaded first — identical result
dsh plugin --profile web add ./dsh-external-dsh-connection-card-host-1.0.0.tgz
```

- Development happens on the **preview line**,
  [`dsh-connection-card-host-preview`](https://github.com/Noob-stupid/dsh-connection-card-host-preview);
  **this repository is the stable face** and only receives promoted releases.
- `lib/` is committed, so the install arrives ready to load — no build step and no build script
  to authorize. (`dsh plugin` requires `pnpm` on PATH.)
- ⚠️ `github:` and the shorthand install the **latest commit on the default branch**, which is
  **not a pinned version**; to pin a version use the Releases tgz above.

> **What was measured for all four forms** (pnpm with the profile's own settings,
> `nodeLinker: hoisted` + `autoInstallPeers: false`; each install lands `lib/` with 161 files):
>
> | Form | Result |
> |:---|:---|
> | `github:user/repo` | ✅ works |
> | `user/repo` (GitHub shorthand) | ✅ works |
> | tgz URL / local path | ✅ works |
> | **bare package name** (no slash → read as an npm name, goes to the registry) | ❌ **404 — do not use** |
>
> Neither `dsh-connection-card-host` nor `@dsh-external/dsh-connection-card-host` exists on npm.

**Compatibility**: `peerDependencies` declares `@deepseek-ai/dsh >=0.2.0-rc.1 <0.3.0` — DSH
**gates on version at install time** and refuses clearly, with a reason, rather than
installing and crashing later.

---

## Writing a card

A card is just an npm package with a `dshCard` manifest:

```json
{
  "name": "my-card",
  "version": "1.0.0",
  "main": "index.js",
  "dshCard": { "id": "my-card", "name": "My card", "entry": "index.js", "api": 1 }
}
```

```js
// index.js — NEVER import anything from @deepseek-ai/*; go through `api`
export function apply(api) {
  api.log(`mounted (scope=${api.scope})`)

  // provide a tool to sessions on the connection
  api.registerTool('greet', async (args) => {
    return `Hello, ${args?.name ?? 'world'}`
  })
}

// panel HTML (optional)
export function renderPanel(api) {
  return `<div>visible to: ${api.scope}</div>`
}
```

| `api` member | Meaning |
|:---|:---|
| `registerTool(name, fn)` | register a tool → sessions call it via `connection_card_tool` |
| `send(kind, text)` / `read()` | send and receive connection messages as one side |
| `on(event, handler)` / `emit(event, data)` | connection-scoped events |
| `scope` | which side this instance serves (`both` / `a` / `b`) |
| `log(...)` | write to the host log |

**`dshCard.api`** declares the **CardAPI version** the card needs (defaults to 1):

- **Adding things does not bump the version** — older cards keep working
- **Only removals or semantic changes bump it** — the host refuses to mount a card that
  requires a newer version, and says why

> This is **our own compatibility guard**: cards don't depend on DSH internals, so a DSH
> upgrade doesn't affect them; but **changing our `CardAPI` does** — and DSH's version gate
> can't see that layer.

See [`docs/card-protocol.md`](docs/card-protocol.md) for details.

---

## Status

**Implemented and measured**

- Connections: drag to connect (toggle semantics), three sessions fully interconnected,
  persistence and restore across restarts
- Permissions: three levels per direction, asymmetric, upgrades need the other side's
  confirmation, refusals explain themselves
- Awareness A: work state collected automatically (0 context)
- Conventions B: the convention box (0 context)
- Messaging C: three urgencies, with automatic degradation
- Cards: template discovery / mounting / per-side visibility / in-panel install /
  **update** / crash isolation
- Card tools: bridge invocation with enforced visibility
- Card directories are **versioned** (so a mounted card can still be updated)

**Known gaps**

| Item | Notes |
|:---|:---|
| **Per-session tool scoping** | The five `connection_*` tools are registered **globally** — a session with no connections still carries ~1,700 tokens. The seam is located (`system-prompt/assemble` waterfall); the listener registration form is still unknown |
| `mountUI` / `requestRemote` | Stubs (`mountUI` only sets a dataset attribute) |
| Card tool schemas | Deliberately take no separate schema; callers must list before calling |

---

## Docs

| Document | Contents |
|:---|:---|
| [`docs/capabilities.md`](docs/capabilities.md) | **Capability report**: per-item measurements, total context cost, known limits |
| [`docs/card-protocol.md`](docs/card-protocol.md) | Card protocol: manifest, CardAPI, install validation, distribution |
| [`docs/compatibility.md`](docs/compatibility.md) | Compatibility: how DSH's version gate works, the two lines of defence |
| [`docs/adapter-api.md`](docs/adapter-api.md) | DSH adapter: the stable interface and its allowlist |

---

<p align="center">
  <sub>MIT · not affiliated with the DSH project</sub>
</p>
