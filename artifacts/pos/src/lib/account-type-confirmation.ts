/** Only a structured server warning can request an exception confirmation. */
export function confirmAccountTypeException(error: unknown): boolean {
  const response = error as { status?: number; data?: { warnings?: { message: string }[] } };
  if (response?.status !== 422 || !Array.isArray(response.data?.warnings) || !response.data.warnings.length) return false;
  return window.confirm(
    `${response.data.warnings.map(warning => warning.message).join("\n\n")}\n\nPotrdite izjemo in nadaljujete?`,
  );
}
