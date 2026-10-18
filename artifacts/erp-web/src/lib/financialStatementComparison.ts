import type { ReportSection } from "@workspace/api-client-react";

// Keep the current ordering and labels; append entries found only in comparison.
function pairByKey<T>(current: T[], compare: T[], key: (entry: T) => string) {
  const currentByKey = new Map(current.map((entry) => [key(entry), entry]));
  const compareByKey = new Map(compare.map((entry) => [key(entry), entry]));
  return [...new Set([...currentByKey.keys(), ...compareByKey.keys()])].map((id) => ({
    entry: (currentByKey.get(id) ?? compareByKey.get(id))!,
    current: currentByKey.get(id),
    compare: compareByKey.get(id),
  }));
}

export function mergeFinancialStatementSections(current: ReportSection[], compare: ReportSection[] = []) {
  return pairByKey(current, compare, (section) => section.class).map((section) => ({
    ...section,
    items: pairByKey(section.current?.items ?? [], section.compare?.items ?? [], (item) => item.accountId),
  }));
}

export type ComparedFinancialSection = ReturnType<typeof mergeFinancialStatementSections>[number];
