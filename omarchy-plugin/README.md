# Pomo Omarchy plugin

`raja.pomo` is an Omarchy shell plugin for the Pomo Android timer. It runs a
small local client in the bar, mirrors the phone clock after pairing, and keeps
the timer usable when the phone is unavailable.

## Install

Place the plugin directory at:

```text
~/.config/omarchy/plugins/raja.pomo/
```

Validate it before enabling it:

```bash
omarchy plugin validate ~/.config/omarchy/plugins/raja.pomo
omarchy-shell shell rescanPlugins
```

Add the widget to the bar if it is not already present:

```bash
omarchy plugin enable raja.pomo --section right
```

The plugin uses the existing Omarchy bar theme and opens its panel on the side
where the widget lives.

## Bar display

The default bar display is `Timer + phase`, for example `25:00 Focus.`. The
widget also supports these per-entry settings:

| `barDisplay` | Bar output |
| --- | --- |
| `Timer + phase` | `25:00 Focus.` (default) |
| `Timer only` | `25:00` |
| `Icon only` | Timer icon |

Settings live inline on the widget entry in
`~/.config/omarchy/shell.json`. For example:

```json
{
  "id": "raja.pomo",
  "barDisplay": "Timer only"
}
```

Hover is always enabled. The tooltip shows only the current `MM:SS` value and
updates while the timer is running. Left-click opens the panel. Middle-click
toggles the timer.

## Pairing

Open the panel and paste the `{url, token}` payload from Pomo Settings, or
enter the phone host, port, and token separately. After saving, the panel shows
`Token saved` and the active endpoint. The form stays hidden until `Replace
pairing` is selected.

The active token is stored by the engine at:

```text
${XDG_DATA_HOME:-~/.local/share}/pomo/omarchy/config.json
```

The directory is owner-only (`0700`) and the config file is owner-only
(`0600`). The raw token is never displayed in the panel.

## Runtime behavior

- When synced, the phone owns the live clock and the plugin sends timer commands
  to the phone API.
- When offline or unpaired, the plugin runs a local timer and queues completed
  sessions for later import.
- The service persists pairing, timer snapshots, and queued sessions under the
  same Pomo data directory.

Run the plugin validator after source changes, then reload the shell:

```bash
omarchy plugin validate /path/to/omarchy-plugin
omarchy-shell shell rescanPlugins
```
