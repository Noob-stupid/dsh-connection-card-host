# Contributing

Thanks for wanting to add to the card ecosystem. Two kinds of entries are welcome:

- **A card** — a package with a `dshCard` manifest
  (protocol: [`docs/card-protocol.md`](docs/card-protocol.md)).
- **A plugin that works as a card** — an ordinary DSH plugin that mounts cleanly on a connection.

## Where the list lives

| What | Where |
|---|---|
| The curated list (English) | [`awesome/README.md`](awesome/README.md) |
| The curated list (中文) | [`awesome/README.zh.md`](awesome/README.zh.md) |
| Full rules + row format + evidence bar | [`awesome/CONTRIBUTING.md`](awesome/CONTRIBUTING.md) |

## The short version

1. Fork this repository.
2. Add **one row** to the right table in [`awesome/README.md`](awesome/README.md)
   (and the Chinese twin if you can — otherwise a maintainer mirrors it).
3. Open a PR titled `list: <name>`.
4. Include evidence: your DSH version, plus the panel's card row — or, if your plugin has a UI,
   the `[ui-capture]` line from `client-debug.log`.

A PR without evidence will be asked for it, then closed. **We list evidence, not claims.**

## What is not accepted

- "It works" with nothing behind it.
- **Global UI** (sidebar / layout / theme replacements) — those belong to the app, not to a
  connection. They can still go in the **known incompatible** section, with the reason.
- Plugins whose host half needs services this plugin does not provide — same as above: list them
  as incompatible, with the reason. That is a useful contribution too.
- Machine-specific paths or private links.

## 中文速览

清单在 [`awesome/README.zh.md`](awesome/README.zh.md)，完整规则在
[`awesome/CONTRIBUTING.md`](awesome/CONTRIBUTING.md)。

**一个 PR 一行**，带上证据（DSH 版本 + 面板里那行卡片行 / 有 UI 的再贴
`client-debug.log` 里 `[ui-capture]` 那行）。

没有证据的 PR 会先要证据、再关 —— **我们列的是证据，不是说法**。

全局 UI（侧栏 / 布局 / 主题替换）不是连接级的，不进正常条目，但可以进
**「已知不兼容」** 并列明原因 —— 那也是一种有用的贡献。
