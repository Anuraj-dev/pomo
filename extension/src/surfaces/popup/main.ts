import { bootInstrument } from "../../shared/instrument";
import { requiredElement } from "../../shared/surface";

bootInstrument(document.body, {
  phaseEl: requiredElement("phase"),
  statusEl: requiredElement("status"),
  timeEl: requiredElement("time"),
  fractionEl: requiredElement("fraction"),
  toggleEl: requiredElement("toggle"),
  skipEl: requiredElement("skip"),
  resetEl: requiredElement("reset"),
  toggleText: (state) => (state.status === "running" ? "Pause" : "Start"),
});
