# dsh-connection-card-host

**English** | [中文](README.zh.md)

> **Makes a *connection* a first-class object in DSH: sessions are nodes, a connection is the container, cards are connection-scoped plugins — a "connection-level plugin host".**

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
[![GitHub stars](https://img.shields.io/github/stars/Noob-stupid/dsh-connection-card-host?style=flat-square&logo=github)](https://github.com/Noob-stupid/dsh-connection-card-host/stargazers)
[![License](https://img.shields.io/github/license/Noob-stupid/dsh-connection-card-host?style=flat-square)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/Noob-stupid/dsh-connection-card-host?style=flat-square)](https://github.com/Noob-stupid/dsh-connection-card-host/commits/main)
[![CI](https://img.shields.io/github/actions/workflow/status/Noob-stupid/dsh-connection-card-host/ci.yml?label=ci&style=flat-square)](https://github.com/Noob-stupid/dsh-connection-card-host/actions/workflows/ci.yml)
[![publish-npm CI](https://img.shields.io/github/actions/workflow/status/Noob-stupid/dsh-connection-card-host/publish-npm.yml?label=publish-npm&style=flat-square)](https://github.com/Noob-stupid/dsh-connection-card-host/actions/workflows/publish-npm.yml)
[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh_plugin-4D6BFE?style=flat-square)](https://github.com/topics/dsh-plugin)
[![npm version](https://img.shields.io/npm/v/@noob-stupid/dsh-connection-card-host?style=flat-square)](https://www.npmjs.com/package/@noob-stupid/dsh-connection-card-host)
[![npm downloads](https://img.shields.io/npm/dm/@noob-stupid/dsh-connection-card-host?style=flat-square)](https://www.npmjs.com/package/@noob-stupid/dsh-connection-card-host)
[![GitHub Release](https://img.shields.io/github/v/release/Noob-stupid/dsh-connection-card-host?style=flat-square)](https://github.com/Noob-stupid/dsh-connection-card-host/releases)
[![dsh.so risk](https://www.dsh.so/badge/dsh-connection-card-host.svg)](https://www.dsh.so/artifact/dsh-connection-card-host/)

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
  <sub>Left: the real thing · Right: the same action as an interaction diagram, showing the toggle semantics</sub>
</p>

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Three layers: awareness / conventions / messaging](#three-layers-awareness--conventions--messaging)
- [Cards on a connection](#cards-on-a-connection)
- [What a card can and cannot do](#what-a-card-can-and-cannot-do)
- [Architecture and cost](#architecture-and-cost)
- [Install](#install)
- [Use](#use)
- [Configuration](#configuration)
- [Writing a card](#writing-a-card)
- [Uninstall](#uninstall)
- [FAQ](#faq)
- [docs](#docs)
- [Maintenance](#maintenance)

---

## What it does

| | |
|:---|:---|
| **See each other** | Look up **which files the other session is editing, how far its plan has got, what tools it last used** — collected automatically, no effort required from the other side |
| **Talk to each other** | Send a message with **an urgency you choose**: notify only (no interruption) / queue / interject / **preemptive interrupt** (fourth tier, **off by default**) |
| **Share tools** | Mount **cards** on a connection: a card can provide tools to the sessions, even with tens of MB of real dependencies |
| **Shared premises** | A "convention box" holds what you agreed on: interfaces, units, naming, who owns what |
| **Stay out of the way** | Awareness is **pull-based** — zero cost unless the other side asks. Unrelated connections **never interrupt you** |

Two examples of the same relationship layer applied: session A asks session B what it is doing
right now, or session B hands session A a tool that only exists on that connection.

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

2. **Done.** Both ends get one quiet notice (who you're connected to, what it enables) —
   **nobody is interrupted**.
3. Want more detail? Open "Connections" in the sidebar, or have the session call
   `connection_peer_work` itself.

Once connected, a **rail** appears beside the session rows, with a **coloured dot at each
end** — that's the permission for that direction:

<p align="center">
  <img src="docs/assets/shot-connections.png" width="620" alt="Connections panel: permissions are set per direction, and cards, awareness and conventions all live under the same connection" />
</p>

Connections persist: they are restored on the next DSH start.

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
【session-1a2b3c4d】
status: running a command (2s ago)
recently touched: <workspace>/src/example.js
progress: turn 12 / step 4
```

### B. Convention box (explicit, zero cost)

What you agreed on: interface signatures, units, coordinate systems, naming, **who owns what**.
Editable in the panel; sessions read and write it with `connection_conventions` / `connection_declare`.

### C. Messaging (four urgencies, **chosen by the sender**)

| Urgency | Under the hood | What the other sees |
|:---|:---|:---|
| `quiet` | `inject` | placed in context **without waking it** — it sees the message next time it works, **uninterrupted** |
| `normal` | `followup` | **queued** — it sees the message once it finishes what it's doing |
| `urgent` | `steer` | **interjected** — inserted into the turn it's **currently running**, read immediately |
| `preempt` | `steer` + optional `cancel` | **preempted** — **interrupts** the turn it's running (fourth tier, **off by default**; falls back to `urgent` when the conditions aren't met, and the message is still delivered) |

`urgent` on an idle peer **degrades to queued** automatically (the next turn starts
immediately, so the effect is the same), and never fails.

**`preempt` conditions** — all of them must hold, otherwise the message degrades to `urgent`
and is still delivered (**it never fails**):

| Condition | Value |
|:---|:---|
| Connection permission | **write** required (a read-only connection must not be able to stop the peer's work) |
| Rate limit | at most **once per connection every 5 minutes** |
| Peer is executing a tool | **never interrupts** — a cancelled half-finished tool leaves a dangling call |
| Peer idle, or its state unknown | does not interrupt; delivers only |

> `preempt` is destructive by design: the interrupted turn loses the work it had already done.
> When you cancel a turn, pass `keepInbox` — the default **clears the inbox**, dropping the
> user's own queued input together with messages from other sessions.

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

### Cards can carry real dependencies

A card may ship its own dependencies (tens of MB is fine) and is installed under
`$DSH_HOME/connection-cards/cards/`, **without touching the DSH profile**.

### Install and update from the panel

<p align="center">
  <img src="docs/assets/shot-card-picker.png" width="620" alt="Card picker: built-in cards install in one click; you can also give a package name, a repo tgz URL or a local directory" />
</p>

A card installs from one of **three sources** — the same three as the **card picker** in the
connection panel:

| Source | What you give it | How it works |
|:---|:---|:---|
| **Package name** (registry) | `monitor-card` / `@scope/monitor-card` | pulls the **tarball** from the registry (one HTTPS GET) |
| **Repo tgz URL** | `https://example.com/card.tgz` | download, then unpack |
| **Local directory** | `D:\my-cards\monitor-card` | copied directly |

- **Install**: package name / repo tgz URL / local directory → into our own directory,
  **no pnpm, no profile changes**; usable immediately, **no DSH restart**
- **Update**: installed cards get a "check for updates" entry with three distinct states
  ```
  「检查更新」→「↑ 更新到 x.y.z」/「已是最新」/「无法检查」
  ```
  **"Couldn't check" is never shown as "up to date"** — that would be lying.
- **Uninstall**: installed cards get an entry that names what will be removed (including the
  card's instances on connections) and asks once. Built-in cards ship with the plugin, so they
  are not offered for removal. The result reports what was removed and what is still in use.

### Statement: third-party / community cards install and work straight away

**You can download and install external DSH-session plugin cards directly, inside DSH, and use
them immediately.** This is not an "official card marketplace", and it is not a curated store
you submit to — it is **open distribution**: any package written against the
[card protocol](docs/card-protocol.md) can be installed into your own DSH from the three
sources above.

**Installed means usable** — once a card is mounted on a connection:

- Sessions on that connection can use the tools it provides (called through the
  `connection_card_tool` bridge) **immediately** — **no DSH restart, no DSH config change**:
  no pnpm, nothing written to `dsh.profile.bundles`
- The card lives in its own directory, `$DSH_HOME/connection-cards/cards/<id>/`, fully isolated
  from the DSH profile

> Third-party / community cards are **not affiliated with** the DSH project; this plugin offers
> no review, no endorsement, and there is no such thing as an "official directory".

---

## What a card can and cannot do

A card is an ordinary DSH plugin, so **not every plugin is card material**. Whether a candidate
can be mounted on a connection, and how much of it survives, is decided by the specifications
below. The card picker labels candidates **adapted / capability / local / global / undecided**
in advance, and **labels only — it never blocks**: mounting is always allowed, and the verdict is
heuristic.

### Mounting: three gates

| Gate | Requirement | If it fails |
|:---|:---|:---|
| **① Scope** | Registers into **connection-scoped** positions (`conversation.*` / `message.*` / `input.*`) or is **pure capability** (no client half) | Registers into **App-scoped** positions (sidebar / layout / settings page / themes / title bar / workspace) → **not recommended as a card**: a global UI does not fit in a connection-scoped panel and collides with the App layout |
| **② Module** | Every dependency in the **import closure of the host entry** resolves | Mount refused, classified as **fatal** (a host capability is missing — the card needs redesign) or **optional** (a third-party dependency is missing — adding it is enough) |
| **③ Capability** | `inject` ⊆ `{tools, effect, llm, prompt}` | Mount refused — the card asks for host services this plugin does not have. **Refusing is the correct behaviour**; the answer is not to widen the capability surface |

Scope of gate ② — only files the entry actually loads at runtime count:
`tests/`, `bin/`, `client/build.mjs` and `*.d.ts` imports are **not** runtime dependencies.

**No pnpm, no build step**: the host never installs dependencies and never builds a package. A
card whose build artifacts are not committed (source only) therefore cannot be mounted — the
refusal says so.

### Client-side UI: what renders and what does not

```
mountable  ≠  source readable  ≠  slots registered  ≠  rendered
```

| Case | Result |
|:---|:---|
| Uses only `slots` / `effect` | **Renders** ✓ |
| Needs client hooks (`useScene` / `useEnabled` / `locale` / `configForms` …) | **Mounts and registers its slots, but fails to render** — the reason is **shown, never a blank panel** ✓ |
| Client bundle size | up to **32 MB** (a self-contained bundle of a few MB is normal: inlined fonts and assets) |
| Component invocation | `createElement(component, {})` — **no props are passed**, so a component that needs slot props fails and is caught by the error boundary |

### Support matrix

| | Supported | Not supported |
|:---|:---|:---|
| **Host tools** | `api.registerTool(name, fn)` → sessions call it through `connection_card_tool` | tools registered into DSH's global loader |
| **Panel** | optional HTML rendered host-side | arbitrary browser-side execution inside the panel |
| **Client UI** | components that use `slots` / `effect` | components that need client hooks, or slot props |
| **Connection events** | `on(event, handler)` / `emit(event, data)` | cross-connection events |
| **Messaging** | `send(kind, text)` / `read()` as one side | automatic mirroring of session content (see [Configuration](#configuration)) |
| **Dependencies** | any dependency vendored inside the card | running pnpm or a build step on your machine |
| **Distribution** | registry / repo tgz / local directory | a curated marketplace or an approval step |
| **Isolation** | per-side visibility, version gating, crash isolation for `import` / `apply` | a card that throws taking down the host |

### Stated boundaries

| Boundary | Meaning |
|:---|:---|
| **Per-side visibility** | Scope is per side: both / A only / B only. **Visible to A ≠ visible to B**; the side that can't see it gets a refusal *with the reason* if it calls anyway |
| **Version gating** | A DSH version mismatch is **refused clearly, with the reason** — rather than installing and crashing later. Cards have a second guard: the CardAPI version (a card requiring a newer one is refused at mount time, with the reason) |
| **Crash isolation** | An exception from a card's import / apply does not take down the host |
| **Not rewritten** | We do not rewrite DSH's transport, permissions or plugin system, and a card is **not registered into DSH's global loader** |

---

## Architecture and cost

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
│  the single exit point for all DSH interaction              │
└─────────────────────────────────────────────────────────────┘
```

### Permissions are **per direction**

One line, one dot at each end; the colour is the permission **for that direction** — the two
directions are independent, so you can have "A may send, B may only watch":

<p align="center">
  <img src="docs/assets/demo-permission.svg" width="640" alt="Line colour shows the permission in that direction: grey = read-only, blue = can suggest, orange = can write; the two ends can differ" />
</p>

| Direction permission | Allows |
|:---|:---|
| **Read-only** | awareness and the convention box (both are pull-based, and independent of permission) |
| **Suggest** | messaging that does not modify the peer's work |
| **Write** | messaging that can change the peer's behaviour, including `preempt` |

Lowering a permission takes effect immediately; raising one requires confirmation from the side
being granted it. Refusals explain themselves.

### What it costs

| Item | Cost | Notes |
|:---|:---|:---|
| **Awareness (layers A + B)** | **0 context** | pull-based; costs nothing unless the peer queries |
| **Card tools** | **1 resident schema** | instead of one per card tool |
| **Unrelated connections** | **0 interruptions** | connecting doesn't wake anyone; unrelated sessions carry on |
| **Resident tool schemas** | 5 `connection_*` tools, hidden from sessions with no connections | tool schemas are filtered per session scope, so a session with no connections carries none of them |

A session that has at least one connection carries the five `connection_*` tool schemas.

---

## Install

**From npm** (recommended, version-pinnable):

```sh
dsh plugin --profile web add @noob-stupid/dsh-connection-card-host
```

**Pinned to a version** — use the tgz attached to a Release:

```sh
dsh plugin --profile web add https://github.com/Noob-stupid/dsh-connection-card-host/releases/download/<tag>/noob-stupid-dsh-connection-card-host-<version>.tgz

# the same tgz, downloaded first — identical result
dsh plugin --profile web add ./noob-stupid-dsh-connection-card-host-<version>.tgz
```

**Straight from GitHub** (installs the **latest commit on the default branch**, not a pinned version):

```sh
dsh plugin --profile web add github:Noob-stupid/dsh-connection-card-host

# same thing, GitHub shorthand (the github: prefix is optional) — a slash means a GitHub repo
dsh plugin --profile web add Noob-stupid/dsh-connection-card-host
```

**Prerequisites**

- `pnpm` on `PATH` — `dsh plugin` shells out to it.
- **Compatibility**: `peerDependencies` declares `@deepseek-ai/dsh >=0.2.0-rc.1 <0.3.0` (plus
  `@deepseek-ai/cordis` and the two `@deepseek-ai/dsh-client-*` packages). DSH **gates on version
  at install time** and refuses clearly, with a reason, rather than installing and crashing later.
- All four peers carry `peerDependenciesMeta.optional`, so that installing by package name
  **adds exactly one package** and does **not** drag the `@deepseek-ai/*` dependency tree into
  your profile. This plugin **imports no `@deepseek-ai/*` package at runtime** (the two
  browser-side ones are injected by DSH's `__ModuleLoader__`), and marking them optional
  **does not weaken the gate** — DSH's `evaluatePluginCompatibility` reads only
  `peerDependencies`. Details in [`docs/compatibility.md`](docs/compatibility.md).
- `lib/` is committed and shipped, so the install arrives ready to load — there is no build step
  and no build script to authorize.

---

## Use

**Build a connection** — the [quick start](#quick-start) covers the two drag gestures and the
sidebar panel. The drop target is the toggle, and connections are restored on restart.

**Set permissions** — per direction, in the connection panel. Lowering takes effect immediately;
raising needs the other side's confirmation.

**Let the sessions work** — with a connection in place the sessions get the
`connection_*` tools:

| Tool | Purpose |
|:---|:---|
| `connection_peer_work` | read the peer's work state (layer A) |
| `connection_conventions` | read the convention box (layer B) |
| `connection_declare` | write the convention box (layer B) |
| `connection_send` | send a message, with an urgency (layer C) |
| `connection_card_tool` | list and call the tools the cards on this connection provide |

Awareness tools (`connection_peer_work`, `connection_conventions`) are read-only and cannot
modify the peer.

---

## Configuration

There is **no config file** for this plugin — it takes no settings schema. Everything that is
configurable is configured in the UI, and everything else lives in one directory:

| Where | Holds |
|:---|:---|
| Connection panel (sidebar) | connections, per-direction permissions, the convention box, card mounting |
| Card picker (connection panel) | installing and updating cards |
| `$DSH_HOME/connection-cards/` | all persistent state: `connections.json`, installed cards, the tamper-evident `audit.log` |

Two behaviours are deliberately **off by default** and are enabled by an explicit action:

| Behaviour | Default | How to turn it on |
|:---|:---|:---|
| `preempt` (preemptive interrupt) | **off** | requires **write** permission on the connection (see [layer C](#three-layers-awareness--conventions--messaging)) |
| Third-party card adaptation | **off** | create `$DSH_HOME/connection-cards/adapter.enabled`; delete the file to turn it back off |

**Automatic mirroring of session content is permanently off** — nothing is forwarded between
sessions unless a session calls `connection_send`. Awareness (layers A and B) is the pull-based
alternative.

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

## Uninstall

**Remove the plugin**

```sh
dsh plugin --profile web remove @noob-stupid/dsh-connection-card-host
```

**Remove its state** — the plugin keeps everything under one directory, so removing it also
removes your connections, your installed cards and the audit log:

```sh
rm -rf "$DSH_HOME/connection-cards"
```

Keep that directory if you intend to reinstall and want your connections back.

---

## FAQ

**Do I need a connection before I can use cards?**
Yes. A card is mounted on a connection, and only sessions on that connection can call the tools
it provides.

**Does mounting a card change my DSH profile?**
No. Cards install under `$DSH_HOME/connection-cards/cards/<id>/`; no pnpm run, nothing written
to `dsh.profile.bundles`, no restart.

**Why can't I mount a popular plugin as a card?**
Most likely gate ② or gate ③ in [what a card can and cannot do](#what-a-card-can-and-cannot-do).
The refusal names which gate failed and why. The most common cause is a package that ships
source without committed build artifacts — the host never builds anything.

**My card mounted but shows nothing.**
See the client-side UI table: a card that needs client hooks registers its slots but cannot
render. The panel shows the reason instead of going blank.

**Does a connection cost me context?**
Awareness (layers A and B) is pull-based and costs nothing until a session asks. Sessions with
no connections carry none of the `connection_*` tool schemas; a session with a connection
carries the five schemas, and card tools cost one bridge schema in total.

**Can I use it with the peer session offline?**
Messages still arrive, but the peer's UI shows them as ordinary messages rather than as a
connection card, and the content is prefixed to say so. Nothing is lost.

**Are third-party cards reviewed?**
No. There is no marketplace, no review and no endorsement — install from sources you trust.

---

## Docs

| Document | Contents |
|:---|:---|
| [`docs/capabilities.md`](docs/capabilities.md) | Capability report: per-item results, total context cost, known limits |
| [`docs/card-protocol.md`](docs/card-protocol.md) | Card protocol: manifest, CardAPI, install validation, distribution |
| [`docs/compatibility.md`](docs/compatibility.md) | Compatibility: how DSH's version gate works, the two lines of defence |
| [`docs/adapter-api.md`](docs/adapter-api.md) | DSH adapter: the stable interface and its allowlist |

---

## Maintenance

**This repository is the stable face** and only receives promoted releases. Development happens
on the preview line, [`dsh-connection-card-host-preview`](https://github.com/Noob-stupid/dsh-connection-card-host-preview).

<details>
<summary>Working on this plugin</summary>

- `lib/` is committed and CI asserts **source/artifact parity** (`scripts/ci/check-src-lib-parity.mjs`),
  so a change to `src/` must be accompanied by a rebuilt `lib/`.
- Host-side changes only take effect after DSH restarts or the plugin is reloaded; client-side
  changes additionally need a page refresh.
- CI runs four gates: syntax check, unit/contract tests plus artifact parity, the plugin patch
  manifest, and a scan for machine-specific paths in tracked files. All four are hard gates.
- `npm test` needs no dependencies and no network.

</details>

---

If this plugin is useful, a **star** helps other DSH users find it.

---

<p align="center">
  <sub>MIT · not affiliated with the DSH project</sub>
</p>
