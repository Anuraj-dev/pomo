# Phone is the live clock; Chrome is a hybrid instrument, not a Replica

Equal Full Replicas under a Member Identity never shipped (`productionActivation`
stayed false) and the cost of journals, admission, mailboxes, and settlement
outgrew the product. We are deleting that dormant system.

The phone remains the source of truth for timer, history, and Crew. PomoLink and
the Omarchy plugin already follow the phone over the LAN API, run locally while
offline, import completed sessions on reconnect, and adopt a live timer under
least-remaining. Chrome will use that same contract. Chrome Crew is removed;
rank on the phone.

This supersedes the extension-Crew ADRs (0009, 0010) and the Replica-shaped
reading of ADR-0011. Chrome still reads and writes `pomo-backup` v1 so a phone
file can import history. It writes an empty Crew object and ignores Crew on
import.

The Chrome phone-API client is the next change, not this one.
