export type HistoryOutcome = "COMPLETED" | "PARTIAL";

export interface HistoryBlock {
  readonly blockId: string;
  readonly phaseId: string;
  readonly startedAtEpochMillis: number;
  readonly elapsedMillis: number;
  readonly outcome: HistoryOutcome;
  readonly tagId: string;
  readonly authoredTagName: string;
  readonly localDate: string;
}

export type HistoryFact =
  | { readonly kind: "CREATE"; readonly factId: string; readonly blockId: string; readonly block: HistoryBlock }
  | { readonly kind: "CORRECT"; readonly factId: string; readonly blockId: string; readonly replacement: HistoryBlock }
  | { readonly kind: "TOMBSTONE"; readonly factId: string; readonly blockId: string }
  | { readonly kind: "SETTLE"; readonly factId: string; readonly blockId: string; readonly selectedFactIds: ReadonlySet<string> };

export interface MaterializedHistory {
  readonly visible: ReadonlyMap<string, HistoryBlock>;
  readonly alternatives: ReadonlyMap<string, readonly HistoryFact[]>;
  readonly conflicts: ReadonlySet<string>;
}

export function materializeHistory(facts: readonly HistoryFact[]): MaterializedHistory {
  const byId = new Map(facts.map((fact) => [fact.factId, fact]));
  if (byId.size !== facts.length) throw new Error("History fact IDs must be unique");
  const alternatives = new Map<string, HistoryFact[]>();
  for (const fact of facts) alternatives.set(fact.blockId, [...(alternatives.get(fact.blockId) ?? []), fact]);
  const visible = new Map<string, HistoryBlock>();
  const conflicts = new Set<string>();
  for (const [blockId, blockFacts] of [...alternatives].sort(([left], [right]) => left.localeCompare(right))) {
    const creates = blockFacts.filter((fact) => fact.kind === "CREATE");
    const corrections = blockFacts.filter((fact) => fact.kind === "CORRECT");
    const tombstones = blockFacts.filter((fact) => fact.kind === "TOMBSTONE");
    const settlements = blockFacts.filter((fact) => fact.kind === "SETTLE");
    if (creates.length !== 1 || settlements.length > 1) { conflicts.add(blockId); continue; }
    const settlement = settlements[0];
    if (settlement?.kind === "SETTLE" && [...settlement.selectedFactIds].some((id) => !byId.has(id))) {
      conflicts.add(blockId); continue;
    }
    if (settlement === undefined && (corrections.length > 1 || (tombstones.length > 0 && corrections.length > 0))) {
      conflicts.add(blockId); continue;
    }
    const selected = settlement?.kind === "SETTLE" ? settlement.selectedFactIds : new Set(blockFacts.map((fact) => fact.factId));
    if (tombstones.some((fact) => selected.has(fact.factId))) continue;
    const selectedCorrections = corrections.filter((fact) => selected.has(fact.factId));
    if (selectedCorrections.length > 1) { conflicts.add(blockId); continue; }
    const create = creates[0]!;
    visible.set(blockId, selectedCorrections[0]?.kind === "CORRECT" ? selectedCorrections[0].replacement : create.kind === "CREATE" ? create.block : never());
  }
  return { visible, alternatives, conflicts };
}

export function dailyTotals(history: MaterializedHistory): ReadonlyMap<string, { readonly elapsedMillis: number; readonly completed: number }> {
  const totals = new Map<string, { elapsedMillis: number; completed: number }>();
  for (const block of history.visible.values()) {
    const current = totals.get(block.localDate) ?? { elapsedMillis: 0, completed: 0 };
    totals.set(block.localDate, {
      elapsedMillis: current.elapsedMillis + block.elapsedMillis,
      completed: current.completed + (block.outcome === "COMPLETED" ? 1 : 0),
    });
  }
  return totals;
}

export interface SessionTag {
  readonly tagId: string;
  readonly name: string;
  readonly paletteSlot: number;
  readonly archived: boolean;
  readonly mergedInto: string | null;
}

export function applyTag(current: ReadonlyMap<string, SessionTag>, next: SessionTag, workTagId: string, defaultTagId: string): {
  readonly tags: ReadonlyMap<string, SessionTag>; readonly defaultTagId: string;
} {
  if (next.name.trim().length === 0 || !Number.isSafeInteger(next.paletteSlot) || next.paletteSlot < 0) throw new Error("invalid tag");
  if (next.tagId === workTagId && (next.archived || next.mergedInto !== null)) throw new Error("Work tag is permanent");
  if (next.mergedInto !== null && (!current.has(next.mergedInto) || next.mergedInto === next.tagId)) throw new Error("invalid tag merge");
  const tags = new Map(current).set(next.tagId, next);
  return { tags, defaultTagId: tags.get(defaultTagId)?.archived === false ? defaultTagId : workTagId };
}

export const INDEPENDENT_CONFIRMATION_THRESHOLD = 10;

export function authorizeDestructiveHistory(targetBlockIds: ReadonlySet<string>, confirmationScope: ReadonlySet<string>): boolean {
  return targetBlockIds.size > 0 && (targetBlockIds.size < INDEPENDENT_CONFIRMATION_THRESHOLD ||
    (targetBlockIds.size === confirmationScope.size && [...targetBlockIds].every((id) => confirmationScope.has(id))));
}

function never(): never { throw new Error("unreachable History fact"); }
