# bb-plugin-rtk

Rewrite Terminal Kommand for BB. A port of
[ogallotti/rtk-hermes](https://github.com/ogallotti/rtk-hermes): transparently
rewrites shell commands through the `rtk` CLI proxy for 60–90% token savings
on verbose output (builds, tests, git diffs, package-manager output).

## Tools

- **`rtk_shell`** — runs a shell command through RTK for filtered output.
  Wraps your command: `rtk_shell('git diff')` rewrites it and runs it through
  `rtk`, returning only the meaningful output. Use it for verbose commands
  (builds, tests, git diffs, cargo/build output, package installs). For
  unfiltered output (reading files, listing directories), use the terminal
  tool instead.

## How it works

1. `rtk rewrite <command>` produces an optimised command string.
2. The rewritten command is executed through RTK as a shell command.
3. Only the filtered stdout (and any stderr) is returned to the agent.

## Settings

| Setting | Default | Description |
|---|---|---|
| `rtkPath` | `/opt/homebrew/bin/rtk` | Absolute path to the `rtk` binary (check with `which rtk`). |

## Install

```sh
npm install
bb plugin install .
```

After editing sources, reload:

```sh
bb plugin reload rtk
```

## Configure

```sh
bb plugin config rtk
bb plugin config rtk set rtkPath /usr/local/bin/rtk
```

## Build

```sh
bb plugin build
```

## Fork provenance

Rift Labs fork: https://github.com/euforicio/rift-plugin-rtk
Upstream: https://github.com/prismatic7/bb-plugin-rtk
