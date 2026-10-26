# Awesome DSH Connection Cards

> Cards and card-adapter plugins for [`dsh-connection-card-host`](../README.md).

A **card** is a small package with a `dshCard` manifest that attaches to **one connection**.
It can provide tools to that connection's session, subscribe to events, or render its own UI
inside the connection panel.

You do **not** have to write a card from scratch: **any ordinary DSH plugin can be mounted as a
card** (see [What a card can and cannot do](../README.md#what-a-card-can-and-cannot-do)).
The list below collects both — cards, and plugins that work well as cards.

## Contents

- [Built-in cards](#built-in-cards)
- [Community cards](#community-cards)
- [Card-adapter plugins](#card-adapter-plugins)
- [Known incompatible](#known-incompatible)
- [Submitting](#submitting)

## Built-in cards

Shipped with the plugin — no install needed, pick one in the card candidate list.

| Card | What it does | Needs (read / write) | Events |
|---|---|---|---|
| **Goal relay** (`goal-relay-card`) | Relays a goal and its status to the peer so both sides track the same "what are we doing" | `goal_status` / `relay_goal` | `goal_updated`, `goal_completed` |
| **Monitor** (`monitor-card`) | Watches the peer's preset state and session activity; raises `preset_error` / `session_idle` | `preset_status`, `session_log` / — | `preset_error`, `session_idle` |
| **Self-heal** (`self-heal-card`) | On `preset_error`, asks the peer to repair its preset, then reports the outcome | `preset_status` / `repair_preset` | `preset_error`, `preset_repaired` |
| **Connection etiquette** (`connection-etiquette`) | Teaches the four urgency levels (`quiet` / `normal` / `urgent` / `preempt`) to both sides and forwards notes with the urgency you choose | — / `send_message` | — |

## Community cards

_None listed yet — the first one could be yours._ See [Submitting](#submitting).

## Card-adapter plugins

Ordinary DSH plugins that mount as a card. "Status" says what was actually observed on a real host.

| Plugin | What it brings to the connection | Status |
|---|---|---|
| [`dsh-client-ui-voice`](https://github.com/hajixiaolei-art/dsh-client-ui-voice) | A push-to-talk voice input control | ✅ mounts · UI captured and rendered · 1 slot |
| [`gal-view`](https://github.com/Ayase34/gal-view) | A model/scene viewer panel | ⚠️ mounts · slots registered · rendering needs client hooks — reported and tracked, see the issue tracker |

## Known incompatible

Listed so you do not spend an evening on it. The refusal in the panel names the exact reason.

| Plugin | Why it cannot mount (today) |
|---|---|
| [`dsh-usage`](https://github.com/linxin666/dsh-usage) | Its host half imports 11 host/client packages this plugin does not provide (`credentials`, `webServer`, `session`, `settings`, …). It needs a different kind of host, not a card. |
| Sidebar / theme / layout replacements | **Global** UI, not connection-scoped. They are meant to be installed into the app; mounting them on one connection has nowhere to go. The candidate list marks these as `global`. |

## Submitting

One PR, one row. Both **cards** and **plugins that work as cards** are welcome.
Format and requirements: [`CONTRIBUTING.md`](CONTRIBUTING.md).

Two things that get a PR merged quickly:

1. **It actually works** — say which DSH version you tried, and paste the panel's card row
   (or the `client-debug.log` line starting with `[ui-capture]` if your plugin has UI).
2. **The row is honest** — if rendering only works for you, say so. "Works on my machine, here is
   the log" is worth far more than "works" with nothing behind it.

---

<sub>MIT · not affiliated with the DSH project</sub>
