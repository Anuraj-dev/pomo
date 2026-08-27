let meta = #{
    name: "omarchy-pomo-plugin",
    description: "Build the Omarchy bar plugin that mirrors PomoLink firmware: local timer, disk persistence, LAN rediscovery, session import, least-remaining adopt",
    when_to_use: "When building or repairing the raja.pomo Omarchy plugin against the NodeMCU firmware protocol",
    phases: [
        #{ title: "Scan", detail: "read firmware + protocol + Omarchy plugin contract" },
        #{ title: "Implement", detail: "write omarchy-plugin in the worktree" },
        #{ title: "Review", detail: "adversarial review until approved or three rounds" },
        #{ title: "Install", detail: "copy into ~/.config/omarchy/plugins after approval" },
    ],
};

let scan_schema = #{
    "type": "object",
    "properties": #{
        "brief": #{ "type": "string" },
        "pitfalls": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let impl_schema = #{
    "type": "object",
    "properties": #{
        "plugin_dir": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "validate_ok": #{ "type": "boolean" },
    },
};

let review_schema = #{
    "type": "object",
    "properties": #{
        "approved": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "findings": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

fn firmware_rules() {
    let t = "";
    t += "You are building raja.pomo, an Omarchy (Quickshell) bar plugin that is a hybrid desk client like firmware/PomoLink, NOT the thin desktop-client, and NOT the Chrome/Android replica OperationKernel on origin/main.\n";
    t += "Read the real files with read_file/grep before writing. Do not invent protocol fields.\n\n";
    t += "AUTHORITY FILES (worktree):\n";
    t += "- firmware/README.md\n";
    t += "- firmware/PomoLink/PomoClient.cpp PomoClient.h\n";
    t += "- firmware/PomoLink/TimerModel.cpp TimerModel.h\n";
    t += "- firmware/PomoLink/SessionQueue.cpp SessionQueue.h\n";
    t += "- firmware/PomoLink/ConfigStore.cpp ConfigStore.h\n";
    t += "- docs/protocol.md (LAN phone API, mDNS, import, adopt, WebSocket). Ignore app/src/main/java/com/pomo/sync and extension/src/sync.\n";
    t += "- docs/superpowers/specs/2026-07-22-nodemcu-hardware-timer-design.md hybrid addendum\n";
    t += "- desktop-client/ only as pairing JSON shape reference ({url, token}). Desktop-client must NOT own a live clock.\n\n";
    t += "OMARCHY FILES (this machine):\n";
    t += "- ~/.config/omarchy/plugins/bredda.localsend (service + bar-widget, keepLoaded, Process daemon)\n";
    t += "- ~/.config/omarchy/plugins/io.github.mich-nduka.omaports (Panel + Service child, bar stays honest while closed)\n";
    t += "- /usr/share/omarchy/shell/plugins/panels/clock (BarWidget + nested Panel, open/close/opened, hostWidget)\n";
    t += "- /usr/share/omarchy/shell/Ui/Panel.qml, BarWidget.qml, WidgetButton.qml\n";
    t += "- /usr/share/omarchy/shell/Commons/Color.qml Style.qml\n";
    t += "- omarchy plugin validate <folder> is the install gate. No symlinks. id must not be omarchy.*\n\n";
    t += "BEHAVIOUR — copy firmware, do not invent a third clock model:\n";
    t += "1. Modes: BOOT/DISCOVERING/CONNECTING/SYNCED/OFFLINE/UNPAIRED. Markers on the bar: space=SYNCED, ~=OFFLINE, ?=UNPAIRED, .=connecting/boot.\n";
    t += "2. OFFLINE/UNPAIRED: plugin owns the live Pomodoro. Start/pause/resume, skip, reset, extend +300s. Tick from wall clock, remaining derived from stored end point (not tick accumulation). Natural rundown queues a completed session. Skip does NOT queue a completion cue as phase_complete.\n";
    t += "3. Persistence under $XDG_DATA_HOME/pomo/omarchy (default ~/.local/share/pomo/omarchy): timer.json, sessions.json, config.json. Atomic temp+rename. Queue cap 32, drop oldest. Restore running/paused across plugin/engine restart; stopped clears timer snapshot. client_id sequence persists.\n";
    t += "4. Discovery: avahi-browse _pomo._tcp. Probe each candidate with GET /api/status + X-Pomo-Token. First HTTP 200 wins. Configured host fallback skips mDNS. 401 -> UNPAIRED (local timer still works). Rediscover every 5s while OFFLINE plus REST probe of a known host.\n";
    t += "5. Enter-SYNC is promoted ONLY by the first authenticated WebSocket type=state frame while CONNECTING. REST probes never promote to SYNCED.\n";
    t += "6. Enter-SYNC pipeline (firmware PomoClient::enterSyncFromPhoneState): (a) snapshot phone status from that WS frame, (b) POST /api/sessions/import, drop accepted and quarantined rejected client_ids, stay CONNECTING and retry in 5s if import incomplete, (c) if plugin timer is live, least-remaining adopt, (d) defer GET /api/config until SYNC is stable (~5 min, retry ~1 min on fail). source field for import: omarchy.\n";
    t += "7. Least remaining (POST /api/timer/adopt). Example the user gave: 25m timer, laptop 20m remaining, phone 23m remaining -> laptop wins, adopt laptop onto phone. Rules: phone STOPPED + plugin live => always adopt; same session (start_time+phase) => always adopt; both live on different sessions => adopt only if plugin remaining < phone remaining (strict); otherwise HTTP 409 timer_busy, plugin SNAPS to phone. Transport fail: keep local only if phone was stopped; if phone was live, snap. Never two live clocks after merge. Once SYNCED the phone owns the sole live clock; plugin mirrors WS/REST and sends REST commands (toggle/skip/reset/extend). Live adopt requires start_time > 0.\n";
    t += "8. SYNCED display: apply state before re-anchoring epoch cache. Project remaining with server_time. Reject older/out-of-order frames for the same start_time+phase that would inflate remaining unless duration grew (extend). ~20s stale WS -> soft resync while REST reachable; then OFFLINE takeover of last remaining.\n";
    t += "9. phase_complete WS event: notify (omarchy-notification-send or equivalent). Ignore unknown WS types. Do not buzz/notify on skip/reset.\n";
    t += "10. Pairing: plugin settings token, optional host, port default 9876. Accept pasted {url,token} JSON. Never commit secrets. Token lives in settings / local config, mode 0600.\n";
    t += "11. UI: bar shows MM:SS remaining, phase, connection marker, glanceable. Left click opens panel. Panel: toggle, skip, reset, extend +5m, pairing fields, connection status. Use qs.Ui Panel / WidgetButton / Color / Style. Theme colors, no new palette. defaultSection right.\n";
    t += "12. Engine: Python 3 stdlib only (this machine has no websockets, websocket-client, zeroconf, websocat, or QtWebSockets). Write a minimal RFC6455 client. avahi-browse for mDNS. curl or urllib for REST. Long-lived bin/pomo-link: stdin newline commands, stdout NDJSON status. Service.qml keepLoaded starts it. Do not pip install.\n";
    t += "13. Repo layout: WORKTREE/omarchy-plugin/ only. Do not edit Android, firmware, extension, desktop-client, or the dirty firmware-branch checkout. Do not git commit, push, or PR. Do not run Gradle/ktlint/Android tests. You MAY run python3 -m unittest for the engine and omarchy plugin validate.\n";
    t += "14. Plugin id raja.pomo, kinds service + bar-widget, keepLoaded true, entryPoints.service Service.qml, entryPoints.barWidget widget/BarWidget.qml. No symlinks anywhere in the plugin folder.\n";
    t
}

let repo = "";
if (args != () && args.repo != ()) {
    repo = args.repo;
}
if (repo == "") {
    pause("verification", "Pass args.repo — absolute path to the feat/omarchy-pomo-plugin worktree.");
}

phase("Scan");
log("Scanning firmware, protocol, and Omarchy plugin contract in " + repo);

let scan_prompt = "";
scan_prompt += "Read-only scan. Repo: " + repo + "\n";
scan_prompt += firmware_rules();
scan_prompt += "\nUse read_file and grep on those files. Return brief (how enter-SYNC, persist, and least-remaining actually work in THIS tree) and pitfalls (gotchas the implementer will miss). Empty pitfalls only after reading PomoClient.cpp enterSyncFromPhoneState, TimerModel.h, SessionQueue.h, docs/protocol.md adopt section, and one Omarchy plugin manifest+Panel.\n";

let scan = agent(scan_prompt, #{
    label: "scan",
    capability_mode: "read-only",
    output_schema: scan_schema,
});

let scan_blob = "";
if (scan != () && scan.success) {
    scan_blob = json_encode(scan.output);
} else {
    scan_blob = "{\"brief\":\"scan failed; follow firmware_rules from the prompt\"}";
    log("Scan agent failed; implementer will use the orchestrator contract");
}

phase("Implement");

fn impl_prompt(repo_path, scan_text, extra) {
    let p = "";
    p += "Implement the raja.pomo Omarchy plugin in this worktree and nowhere else.\n";
    p += "WORKTREE (only write root): " + repo_path + "\n";
    p += "Create " + repo_path + "/omarchy-plugin/ with a working plugin.\n\n";
    p += firmware_rules();
    p += "\nSCAN NOTES (untrusted, re-check the files):\n";
    p += scan_text;
    p += "\n";
    p += extra;
    p += "\nDo the work with file tools. After writing, run: omarchy plugin validate ";
    p += repo_path + "/omarchy-plugin\n";
    p += "Also add focused Python unit tests for least-remaining adopt decision, stale-frame rejection, and session queue drop-oldest, and run them with python3 -m unittest.\n";
    p += "Return plugin_dir (absolute), summary of what you shipped, validate_ok true only if omarchy plugin validate exited 0.\n";
    p
}

let first_impl_extra = "This is the first implementation pass. Ship a complete plugin, not a stub. Other dirty git state exists in a different checkout; do not revert or touch it.\n";
let implementer = agent(impl_prompt(repo, scan_blob, first_impl_extra), #{
    label: "implementer",
    capability_mode: "all",
    output_schema: impl_schema,
});

let implementer_id = ();
if (implementer != () ) {
    implementer_id = implementer.agent_id;
}

let approved = false;
let review_summary = "";
let findings_blob = "[]";
let last_plugin_dir = repo + "/omarchy-plugin";
let rounds_done = 0;
let max_rounds = 3;

phase("Review");

fn review_prompt(repo_path, plugin_dir, round_num) {
    let p = "";
    p += "Adversarial review of the raja.pomo plugin. Do not edit files.\n";
    p += "WORKTREE: " + repo_path + "\n";
    p += "PLUGIN DIR: " + plugin_dir + "\n";
    p += "ROUND: " + round_num.to_string() + " of 3\n\n";
    p += firmware_rules();
    p += "\nRead the shipped plugin (manifest, QML, Python engine, tests) AND the firmware/protocol files. Approve only if all of these are true with evidence you inspected:\n";
    p += "- omarchy plugin contract would pass validate (manifest kinds, entry points exist, no omarchy.* id, no .. in paths)\n";
    p += "- local timer + disk persistence + restore of running/paused\n";
    p += "- rediscovery when the phone appears (mDNS + 5s retry + known-host REST probe)\n";
    p += "- enter-SYNC only from WS state; REST does not promote\n";
    p += "- import then least-remaining adopt; laptop 20m vs phone 23m adopts laptop; 409 snaps to phone\n";
    p += "- never dual live clocks after merge\n";
    p += "- does not use OperationKernel / replica sync\n";
    p += "- bar remaining time + panel controls + pairing settings\n";
    p += "Set approved=true only with that evidence. Otherwise approved=false and list concrete findings as file:issue strings. Empty findings is valid only after reading the plugin files and finding no contract break.\n";
    p
}

for round in 0..3 {
    if (approved) {
        break;
    }
    rounds_done = round + 1;
    log("Review round " + rounds_done.to_string());
    let reviewer = agent(review_prompt(repo, last_plugin_dir, rounds_done), #{
        label: "reviewer-" + rounds_done.to_string(),
        capability_mode: "read-only",
        output_schema: review_schema,
    });
    let this_approved = false;
    let this_findings = "[]";
    if (reviewer != () && reviewer.success && reviewer.output != ()) {
        if (reviewer.output.approved == true) {
            this_approved = true;
        }
        if (reviewer.output.summary != ()) {
            review_summary = reviewer.output.summary;
        }
        if (reviewer.output.findings != ()) {
            this_findings = json_encode(reviewer.output.findings);
        }
    } else {
        log("Reviewer failed closed; treating as not approved");
        this_findings = "[\"reviewer returned no usable verdict\"]";
    }
    findings_blob = this_findings;
    if (this_approved) {
        approved = true;
        log("Reviewer approved");
        break;
    }
    if (round == 2) {
        log("Three review rounds exhausted without approval");
        break;
    }
    log("Fixing reviewer findings");
    let extra = "";
    extra += "FIX PASS. Do not revert unrelated files. Address every finding. Re-run omarchy plugin validate and python tests.\n";
    extra += "FINDINGS JSON:\n";
    extra += findings_blob;
    extra += "\n";
    let opts = #{
        label: "implementer-fix-" + (round + 1).to_string(),
        capability_mode: "all",
        output_schema: impl_schema,
    };
    if (implementer_id != ()) {
        opts.resume_from = implementer_id;
    }
    let fixer = agent(impl_prompt(repo, scan_blob, extra), opts);
    if (fixer != ()) {
        implementer_id = fixer.agent_id;
        if (fixer.success && fixer.output != () && fixer.output.plugin_dir != ()) {
            last_plugin_dir = fixer.output.plugin_dir;
        }
    }
}

if (!approved) {
    let report = "";
    report += "Plugin not approved after " + rounds_done.to_string() + " review rounds.\n";
    report += "Worktree: " + repo + "\n";
    report += "Plugin dir: " + last_plugin_dir + "\n";
    report += "Last review: " + review_summary + "\n";
    report += "Findings: " + findings_blob + "\n";
    let path = write_scratch_file("report.md", report);
    complete(#{
        approved: false,
        plugin_dir: last_plugin_dir,
        repo: repo,
        rounds: rounds_done,
        summary: review_summary,
        findings: findings_blob,
        report: path,
        installed: false,
    });
}

phase("Install");
log("Reviewer approved; copying plugin into ~/.config/omarchy/plugins/raja.pomo");

let install_prompt = "";
install_prompt += "Install the approved plugin for live bar testing. Do not commit.\n";
install_prompt += "SOURCE: " + last_plugin_dir + "\n";
install_prompt += "DEST: /home/raja/.config/omarchy/plugins/raja.pomo\n";
install_prompt += "1. Copy files (rsync -a --delete, exclude .git, no symlinks).\n";
install_prompt += "2. omarchy plugin validate DEST must exit 0.\n";
install_prompt += "3. Enable on the right bar section if not already enabled: omarchy plugin enable raja.pomo --section right  (or equivalent omarchy bar put). Do not rewrite unrelated shell.json widgets.\n";
install_prompt += "4. If the bar does not pick it up, omarchy-shell shell rescanPlugins. Do not omarchy refresh shell (that resets user layout).\n";
install_prompt += "Return summary of dest path, validate exit, and whether the widget is in ~/.config/omarchy/shell.json.\n";

let installer = agent(install_prompt, #{
    label: "install",
    capability_mode: "all",
    output_schema: #{
        "type": "object",
        "properties": #{
            "summary": #{ "type": "string" },
            "dest": #{ "type": "string" },
            "validate_ok": #{ "type": "boolean" },
            "enabled": #{ "type": "boolean" },
        },
    },
});

let installed = false;
let install_summary = "";
if (installer != () && installer.success && installer.output != ()) {
    if (installer.output.validate_ok == true) {
        installed = true;
    }
    if (installer.output.summary != ()) {
        install_summary = installer.output.summary;
    }
}

let final_report = "";
final_report += "approved: true\n";
final_report += "plugin_dir: " + last_plugin_dir + "\n";
final_report += "rounds: " + rounds_done.to_string() + "\n";
final_report += "review: " + review_summary + "\n";
final_report += "installed: " + installed.to_string() + "\n";
final_report += "install: " + install_summary + "\n";
let report_path = write_scratch_file("report.md", final_report);

complete(#{
    approved: true,
    plugin_dir: last_plugin_dir,
    repo: repo,
    rounds: rounds_done,
    summary: review_summary,
    installed: installed,
    install_summary: install_summary,
    report: report_path,
});
