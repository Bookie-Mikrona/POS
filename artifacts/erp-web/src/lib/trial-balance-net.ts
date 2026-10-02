/** Signed presentation-only balance; the original gross debit/credit stay unchanged. */
export function trialBalanceNet(debit: string | number, credit: string | number): number {
  return (Math.round(Number(debit) * 100) - Math.round(Number(credit) * 100)) / 100;
}

export function formatTrialBalanceNet(debit: string | number, credit: string | number): string {
  return trialBalanceNet(debit, credit).toLocaleString("sl-SI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}