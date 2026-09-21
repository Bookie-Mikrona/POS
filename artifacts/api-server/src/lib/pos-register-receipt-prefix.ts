/** Escapes a literal value for PostgreSQL LIKE ... ESCAPE '!'. */
export function escapePosReceiptLikeLiteral(value: string): string {
  return value.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
}

/**
 * Builds a literal fiscal register prefix followed by exactly one intentional
 * wildcard. Existing fiscal IDs remain valid even when they contain LIKE
 * metacharacters.
 */
export function getPosReceiptPrefixPattern(ppId: string, bId: string): string {
  return `${escapePosReceiptLikeLiteral(`${ppId}-${bId}-`)}%`;
}