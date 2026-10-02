# dsh-connection-card-host

[中文](README.md) | **English**

> **Makes a *connection* a first-class object in DSH: sessions are nodes, a connection is the container, cards are connection-scoped plugins — a "connection-level plugin host".**

**Why this plugin**: other plugins hard-code their capabilities inside the plugin; this one turns
capability into **cards you install on a connection** — mounting, unmounting and isolation are
all at **connection granularity**.

Running several DSH sessions at once (one researching, one coding, one running experiments) is
normal. What's missing isn't "sessions can see each other" as a feature — it's a **programmable
relationship layer between DSH sessions**: without a "relationship object" to hang things on,
permission boundaries, shared premises and loadable capabilities have nowhere to live.

<p align="center">
  <img src="docs/assets/diagram-connection-platform.svg" width="820" alt="A connection is a platform object: session A and session B are joined by one connection carrying an event bus, a permission boundary, a convention box and a card host; cards mount on the connection and are constrained by its permissions, and the connection reaches DSH through an adapter layer" />
</p>

On top of that relationship layer, the two ends **see each other, talk to each other and share
tools — without getting in each other's way**.

<table>
<tr>
<td width="50%">

**In practice** (screen recording)

<img src="docs/assets/demo-drag-anchor.gif" alt="Dragging a connection line out from the anchor beside the composer" />

</td>
<td width="50%">

**Interaction structure** (diagram)

<img src="docs/assets/demo-drag.svg" alt="Drag-to-connect structure: anchor → session row → rail" />

</td>
</tr>
</table>

<p align="center">
  <sub>Left: the real thing (<a href="docs/assets/demo-drag-anchor.mp4">source video</a>) · Right: the same action as an interaction diagram, showing the toggle semantics</sub>
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
- [Roadmap (planned)](#roadmap-planned)

---

## What it does

| | |
|:---|:---|
| **See each other** | Look up **which files the other session is editing, how far its plan has got, what tools it last used** — collected automatically, no effort required from the other side |
| **Talk to each other** | Send a message with **an urgency you choose**: notify only (no interruption) / queue / interject / **preemptive interrupt** (fourth tier, **off by default**) |
| **Share tools** | Mount **cards** on a connection: a card can provide tools to the sessions, even with tens of MB of real dependencies |
| **Shared premises** | A "convention box" holds what you agreed on: interfaces, units, naming, who owns what |
| **Stay out of the way** | Awareness is **pull-based** — zero cost unless the other side asks. Unrelated connections **never interrupt you** |

---

## Quick start

1. **Connect**: hold the circle to the left of the composer (or the `…` on a session row)
   and drag it onto a row in the session list.

<table>
<tr>
<td width="50%">

**How to start, and the toggle semantics**

- The **circle** left of the composer → drag onto a row
- The **`…`** on a session row → drag onto another row
- The drop target is the toggle: **unconnected row = connect**; **already-connected row = disconnect** (the hover hint tells you which)
- You can also pick two sessions from the "Connections" panel in the sidebar

</td>
<td width="50%">

**Drag from a session row → after connecting** (recording)

<img src="docs/assets/demo-drag-rail.gif" alt="Dragging from a session row; after release a rail appears with per-end permission dots" />

</td>
</tr>
</table>

<p align="center">
  <sub><a href="docs/assets/demo-drag-rail.mp4">Source video for this one</a> (the anchor drag is at the top of this page)</sub>
</p>

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

### C. Messaging (four urgencies, **chosen by the sender**)

| Urgency | Under the hood | What the other sees |
|:---|:---|:---|
| `quiet` | `inject` | placed in context **without waking it** — it sees the message next time it works, **uninterrupted** |
| `normal` | `followup` | **queued** — it sees the message once it finishes what it's doing |
| `urgent` | `steer` | **interjected** — inserted into the turn it's **currently running**, read immediately |
| `preempt` | `steer` + optional `cancel` | **preempted** — **interrupts** the turn it's running (fourth tier, **off by default**; falls back to `urgent` when the conditions aren't met, and the message is still delivered) |

`urgent` on an idle peer **degrades to queued** automatically (the next turn starts
immediately, so the effect is the same), and never fails.

> **The fourth tier, `preempt`, is off by default.** It is destructive: the interrupted turn
> loses the work it had already done. Enabling it requires **write permission** (a read-only
> connection must not be able to stop the peer's work) and is limited to **once per connection
> every 5 minutes**; it **never interrupts while a tool is executing** (a hard red line —
> cancelling a half-finished tool leaves a dangling call); when the peer is idle or its state is
> unknown it does not interrupt at all, it just delivers. If any condition fails it **degrades to
> `urgent` and the message is still delivered** (it never fails).
> **The three original tiers are unchanged**: `preempt` delivers exactly like `urgent` (interject
> while running, queue while idle) and merely adds an optional `cancel`.
>
> Also: `cancel()` must pass `keepInbox` — by default it **clears the inbox**, dropping the user's
> own queued input together with messages from other sessions.

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

### Statement: third-party / community cards install and work straight away

**You can download and install external DSH-session plugin cards directly, inside DSH, and use
them immediately.**

This is not an "official card marketplace", and it is not a curated store you submit to — it is
**open distribution**: any package written against the [card protocol](docs/card-protocol.md)
can be installed into your own DSH from the three sources below.

| Source | What you give it | How it works |
|:---|:---|:---|
| **Package name** (registry) | `monitor-card` / `@scope/monitor-card` | pulls the **tarball** from the registry (one HTTPS GET) |
| **Repo tgz URL** | `https://example.com/card.tgz` | download, then unpack |
| **Local directory** | `D:\my-cards\monitor-card` | copied directly |

(These are the same three sources as the **card picker** in the connection panel.)

**Installed means usable** — once a card is mounted on a connection:

- Sessions on that connection can use the tools it provides (called through the
  `connection_card_tool` bridge) **immediately** — **no DSH restart, no DSH config change**:
  no pnpm, nothing written to `dsh.profile.bundles`
- The card lives in its own directory, `$DSH_HOME/connection-cards/cards/<id>/`, fully isolated
  from the DSH profile

**Three boundaries** (by design, not as "limitations"):

| Boundary | Meaning |
|:---|:---|
| **Per-side visibility** | Scope is per side: both / A only / B only. **Visible to A ≠ visible to B**; the side that can't see it gets a refusal *with the reason* if it calls anyway |
| **Version gating** | A DSH version mismatch is **refused clearly, with the reason** — rather than installing and crashing later. Cards have a second guard: the CardAPI version (a card requiring a newer one is refused at mount time, with the reason) |
| **Crash isolation** | An exception from a card's import / apply does not take down the host |

> Third-party / community cards are **not affiliated with** the DSH project; this plugin offers
> no review, no endorsement, and there is no such thing as an "official directory".

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
bridge, discovers on demand, calls on demand, and visibility is enforced at the bridge
(illustrated under [Cards on a connection](#cards-on-a-connection)).

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
to queue. The fourth tier, `preempt` (a preemptive interrupt that **cuts short** the peer's
running turn), is **off by default**; enabling it requires write permission and is limited to
once per connection every 5 minutes.

### 4. The lines live at `body` level — decoupled from slot containers

The two lines (rail line, drag line) are **not rendered inside a slot container**. They hang off a
**dedicated host** that is the **last child of `document.body`** and carries a near-maximum `z-index`.

**Why it has to be this way**: `z-index` is only comparable **within one stacking context**. Each
plugin slot renders inside a different DSH container, and a different container means a different
stacking context — so if someone else (a skin, an overlay) merely orders **their own container**
above ours, no `z-index` on **our element** can win. If the skin also uses `transform` / `filter` /
`will-change`, it creates yet another stacking context and any `z-index` may stop working.
Observed in the field: with `web-ui-skin-center` installed the lines were **invisible**; disabling
it fixed them — the rail line and the drag line **each failed this way once**.

**The cost (stated plainly)**: the host **always sits at `body` level**, so a future "must be on top"
full-screen modal would have these two lines **drawn over it**. `pointer-events: none` currently
keeps interaction unaffected, so the risk is low.

**If it ever needs tightening**, the suggested fix is a **minimal predicate**: while
`[role="dialog"][aria-modal="true"]` is present, drop the rail below that modal and restore it when
the modal closes — **not** an unconditional hide.

---

## Where it saves

| Item | Number | Notes |
|:---|:---|:---|
| **Awareness (layers A + B)** | **0 context** | pull-based; costs nothing unless the peer queries |
| **Card tools** | **1 resident schema** | instead of one per card tool |
| **Automatic mirroring** | **0 (disabled)** | measured at 77.8% useless content before it was turned off |
| **Unrelated connections** | **0 interruptions** | connecting doesn't wake anyone; unrelated sessions carry on |

**The one fixed cost**: this plugin's five `connection_*` tools cost roughly **1,700 tokens
resident**. (This can be reduced further — see the [roadmap](#roadmap-planned).)

---

## Install

**npm (recommended, version-pinnable)**:

```sh
dsh plugin --profile web add @noob-stupid/dsh-connection-card-host
```

**Straight from GitHub** (installs the **latest commit on the default branch**, not a pinned version):

```sh
dsh plugin --profile web add github:Noob-stupid/dsh-connection-card-host

# same thing, GitHub shorthand (the github: prefix is optional) — a slash means a GitHub repo
dsh plugin --profile web add Noob-stupid/dsh-connection-card-host
```

**Pin a version: use the tgz attached to Releases** (currently v1.0.17):

```sh
dsh plugin --profile web add https://github.com/Noob-stupid/dsh-connection-card-host/releases/download/v1.0.17/noob-stupid-dsh-connection-card-host-1.0.17.tgz

# the same tgz, downloaded first — identical result
dsh plugin --profile web add ./noob-stupid-dsh-connection-card-host-1.0.17.tgz
```

- Development happens on the **preview line**,
  [`dsh-connection-card-host-preview`](https://github.com/Noob-stupid/dsh-connection-card-host-preview);
  **this repository is the stable face** and only receives promoted releases.
- `lib/` is committed (and shipped in the npm package), so the install arrives ready to load —
  no build step and no build script to authorize. (`dsh plugin` requires `pnpm` on PATH.)
- ⚠️ `github:` and the shorthand install the **latest commit on the default branch**, which is
  **not a pinned version**; to pin one use the npm version (`@noob-stupid/dsh-connection-card-host@1.0.17`)
  or the Releases tgz above.

> Measured (pnpm 9.15.9, the profile's own settings): installing by npm name **adds exactly one
> package**, lands `lib/` with 170 files, and does **not** drag the `@deepseek-ai/*` dependencies
> into your profile.

**Compatibility**: `peerDependencies` declares `@deepseek-ai/dsh >=0.2.0-rc.1 <0.3.0`
(plus `@deepseek-ai/cordis` and the two `@deepseek-ai/dsh-client-*` packages) — DSH
**gates on version at install time** and refuses clearly, with a reason, rather than
installing and crashing later.

All four peers carry `peerDependenciesMeta.optional`, for two measured reasons:

- `@deepseek-ai/dsh-client-runtime` has **no** version on the public registry that satisfies the
  range (it stops at `0.1.1-rc.2`) — without `optional`, pnpm hard-fails with
  `ERR_PNPM_NO_MATCHING_VERSION` and the install **doesn't happen**;
- marking only that one is not enough either: pnpm then pulls **the entire `@deepseek-ai/dsh`
  dependency tree (602 packages, 1m36s in measurement)** into your profile — exactly what
  `autoInstallPeers: false` exists to prevent.

This plugin **imports no `@deepseek-ai/*` package at runtime** (nothing in `lib/`; the two
browser-side ones are injected by DSH's `__ModuleLoader__`), so "declare the contract, don't
force the install" is the accurate expression. Marking them optional **does not weaken the
gate** — DSH's `evaluatePluginCompatibility` reads only `peerDependencies`.
Details in [`docs/compatibility.md`](docs/compatibility.md).

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

## Roadmap (planned)

**What this version can do** (implemented and measured)

- Connections: drag to connect (toggle semantics), three sessions fully interconnected,
  persistence and restore across restarts
- Permissions: three levels per direction, asymmetric, upgrades need the other side's
  confirmation, refusals explain themselves
- Awareness A: work state collected automatically (0 context)
- Conventions B: the convention box (0 context)
- Messaging C: four urgencies (the fourth, `preempt`, is **off by default**), with automatic degradation
- Cards: template discovery / mounting / per-side visibility / in-panel install /
  **update** / crash isolation
- Card tools: bridge invocation with enforced visibility
- Card directories are **versioned** (so a mounted card can still be updated)

**Planned** (the items below are **not implemented yet**; the interfaces are in place, the
implementations are still to come)

| Item | Today | v1.1 target |
|:---|:---|:---|
| **Per-session tool scoping** | The five `connection_*` tools are registered **globally** — a session with no connections still carries ~1,700 tokens. The seam is located (`system-prompt/assemble` waterfall); the listener registration form is still unknown | Register only for sessions that are on a connection, removing that resident cost |
| `mountUI` | Interface in place, implementation pending: currently only sets a dataset attribute | Real DOM mounting on the browser side |
| `requestRemote` | Interface in place, implementation pending: the host has no `ctx.remote`, so calls return `not_available` | Remote calls under the peer's allowlist, with auditing |
| Browser-side card panel execution | Not implemented (panel HTML is rendered host-side and handed back) | Evaluate as needed |

> Card tools **deliberately** take no separate schema: callers must list before calling.
> That's a cost/visibility trade-off, not a to-do.

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
  <sub>BSD-3-Clause · not affiliated with the DSH project</sub>
</p>
