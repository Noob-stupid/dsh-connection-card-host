---
name: connection-card
description: Cross-session collaboration over DSH connections: message another session, read what the peer is doing right now, share premises in a convention box, and call tools published by cards mounted on the connection. Use whenever this session is part of a connection and the work touches the other side.
whenToUse: Another session is collaborating on your work; you need to hand something over, ask the peer for something, or read the peer's live work state to align interfaces and avoid duplicate work.
---

# Connection Card

A **connection** in DSH is a first-class object, not a chat aside.

- A session is a node; a connection is a container that holds two sessions.
- **Cards mount on a connection**, not globally — a card can be visible to both ends or to one end only.
- Collaboration is **pull-based awareness**: you query the peer's work state when you need it. Nothing is pushed into your context while you work, so being connected does not eat your idle context.

You interact with all of this through a small set of host tools. Where they are available, they are already registered in your session.

## When to use this

Use the connection tools when:

- **Cross-session collaboration** — you and another session are building the same thing (e.g. one writes the server, one writes the client) and you must agree on interfaces.
- **Handing something over / passing a message** — you need the peer to act, or you want to tell it something it must know.
- **Mounting capability onto the connection** — a card published tools; call them through the connection instead of guessing at the peer's internals.
- **Reading what the peer is doing** — before you touch a shared surface, look at what the peer is changing right now.

Do **not** reach for these tools when you are simply working alone in your session, or when the user asked you to do something purely local.

## The host tools

All of them resolve the connection by itself when your session participates in exactly one; pass `connectionId` when your session is in more than one (the tools list the candidates when they need you to disambiguate).

### `connection_send` — deliver a message to the peer session

```
connection_send({ text: "...", urgency: "normal", kind: "say" })
```

Really delivered into the peer's session; it sees the message on its next turn. **Only the text you pass travels** — no transcript, no file contents, no context from your session is attached. If you need the peer to know a fact, write that fact out.

`kind` picks what you are asking for, and is gated by connection permission:

- `say` — a statement / status sync. Needs at least **suggest** permission in your direction.
- `ask` — a request for the peer to do something. Needs **write** permission.
- `reply` — answering something the peer asked. Needs **write** permission.

Message content is a verbatim string. **Never assume the peer is online, idle, or listening** — delivery can be recorded without reaching the peer's session, and the tool tells you when that happened. Read the result; do not claim the peer "has been informed" if the call reported it could not deliver.

### The four urgency levels

Choose the lowest level that actually achieves your goal. Interruption costs the peer its current line of thought, so the default is the polite one.

| Level | What it really does | Use it for |
|:--|:--|:--|
| `quiet` | Puts the message in the peer's context but **does not wake it**. The peer sees it the next time it is already working. | Progress notes, background information, "you may want to know this". Anything where you are not waiting on the peer. |
| `normal` | **Queued (the default).** The peer sees it when it finishes what it is doing. | Ordinary messages, requests, replies. This is right for the large majority of traffic. |
| `urgent` | Injected at the peer's **next step boundary** — read while it is still on the current turn. | You genuinely need the peer to change behaviour **now**: a blocking question, a stop, or you have spotted it doing something wrong. |
| `preempt` | **Interrupts the turn the peer is currently running**; work in that turn is discarded. | Only "it has already gone off the rails and waiting for the next step boundary is too late". |

Judgement rules:

- **Default to `normal`.** If you are unsure, `normal` is correct.
- `quiet` is for information the peer does not need to act on now.
- `urgent` is for "before your next step, read this". If you find yourself using `urgent` for routine coordination, you are interrupting too much.
- `preempt` is **off by default** and additionally requires **write** permission and is limited to **once per connection every 5 minutes**. When any of those does not hold it degrades to `urgent` automatically and the message is still delivered — so a `preempt` you did not earn is not an error, just an interruption that did not happen. Do not treat `preempt` as a normal channel.

### `connection_peer_work` — read what the peer is doing right now

```
connection_peer_work({})
```

Returns the peer's live work state: which files it is touching, how far its plan has got, what tools it recently used. The state is **collected automatically** — the peer does not have to tell you anything, and this call costs the peer nothing and adds nothing to its context. This is the pull-based awareness path: use it to align before you both edit the same surface.

If it reports no work state yet, the peer simply has not started — it is not an error.

### `connection_conventions` — read the shared premises

```
connection_conventions({ keyword: "interface" })
```

Lists what the two ends have agreed on: interfaces, field names, units, coordinates, naming, file ownership boundaries. **Check this before you build anything that touches the peer's side**, so you do not implement against your own assumption. The optional `keyword` narrows the search.

Permalink: an empty convention box means nothing has been agreed yet — declare what you need.

### `connection_declare` — put a premise into the shared box

```
connection_declare({ topic: "interface", text: "POST /orders takes { id: string, qty: number }" })
```

Use it for **things the peer will get wrong if it does not know them** — the test is "the peer will build the wrong thing without this". Use `supersedes` to replace an older entry by id (the old one is marked superseded, not deleted).

Do **not** declare progress or temporary state: that belongs to work state, which is already collected automatically. And do not paste large documents in — an entry is a premise, one that can be read and acted on, not a dump.

### `connection_card_tool` — call tools published by cards on the connection

```
connection_card_tool({})                                    // list cards and their tools
connection_card_tool({ instanceId: "...", tool: "render", args: { ... } })
```

Cards are mounted **on the connection** and may be visible to **one end only**. Call it with no `tool` to see what your end can actually reach. If you ask for a card that is scoped to the other end, the tool says so explicitly rather than failing vaguely.

## Boundaries and non-negotiables

- **Permissions are directional.** A connection has separate `a→b` and `b→a` levels (`read` / `suggest` / `write`). Being allowed to do something toward the peer does not mean the peer may do it toward you. When a call is refused, the reason names the permission you lack.
- **Card visibility is per end.** Do not assume a card you can see is visible to the peer, or the reverse.
- **State is persistent.** Connections, work state and conventions live under `$DSH_HOME/connection-cards/` and are restored after a restart. What you declare outlives your session — that is a reason to keep entries accurate, and to use `supersedes` instead of leaving a stale premise in force.
- **Never abuse urgency.** `urgent` and `preempt` are not ordinary communication; they are for stopping or redirecting the peer. Overusing them is a real cost to the peer and to the collaboration.
- **Never assume the peer is online.** Check the delivery result.
- **Never dump large content as "work state".** Work state is collected, not declared; and `connection_declare` is for premises, not for bulk text.
- **Do not fake the peer's knowledge.** If a send reports it was recorded but not delivered, say that.

## Examples

**1 — Align on an interface before implementing.**

```
connection_peer_work({})                             // what is the peer building right now?
connection_conventions({ keyword: "interface" })     // has anything been agreed?
connection_declare({ topic: "interface",
  text: "GET /orders returns { id: string, totalCents: number } — amounts are integer cents" })
```

Then implement against that declared shape. The peer sees it the next time it queries the box.

**2 — Ask the peer to do something, without interrupting it.**

```
connection_send({ kind: "ask", urgency: "normal",
  text: "Please add the `totalCents` field to the order DTO — I am depending on it in the client." })
```

`normal` because it is a real request but not an emergency. Use `urgent` only if you cannot proceed one more step without it.

**3 — Tell the peer something it can read later, without waking it.**

```
connection_send({ kind: "say", urgency: "quiet",
  text: "FYI I renamed the config key to `orders.currency`. No action needed." })
```

**4 — Stop the peer before it finishes going wrong.**

```
connection_send({ kind: "ask", urgency: "urgent",
  text: "Stop: `totalCents` must stay an integer — do not switch it to a float." })
```

Escalate to `preempt` only if it is mid-turn and already writing the wrong value, and you have write permission.
