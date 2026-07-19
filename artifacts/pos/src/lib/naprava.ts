export function getNapravaId(): string {
  const stored = localStorage.getItem("napravaId");
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem("napravaId", id);
  return id;
}
