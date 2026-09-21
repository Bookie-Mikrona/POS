type VnosnoPolje = HTMLInputElement | HTMLTextAreaElement;

function najdiDrsniVsebnik(element: HTMLElement): HTMLElement | null {
  let stars = element.parentElement;
  while (stars && stars !== document.body) {
    const slog = window.getComputedStyle(stars);
    if (
      /(auto|scroll)/.test(slog.overflowY)
      && stars.scrollHeight > stars.clientHeight
    ) {
      return stars;
    }
    stars = stars.parentElement;
  }
  return null;
}

export function prikaziPoljeNadPosTipkovnico(element: VnosnoPolje): void {
  if (!element.isConnected) return;
  const tipkovnica = document.querySelector<HTMLElement>("[data-pos-keyboard-panel]");
  if (!tipkovnica) return;

  const odmik = 16;
  const vidniVrh = (window.visualViewport?.offsetTop ?? 0) + odmik;
  const vidnoDno = tipkovnica.getBoundingClientRect().top - odmik;
  const polje = element.getBoundingClientRect();
  if (vidnoDno <= vidniVrh || (polje.top >= vidniVrh && polje.bottom <= vidnoDno)) return;

  const razpolozljivaVisina = vidnoDno - vidniVrh;
  const ciljniVrh = vidniVrh + Math.max(0, (razpolozljivaVisina - polje.height) / 2);
  const premik = polje.top - ciljniVrh;
  const vsebnik = najdiDrsniVsebnik(element);

  if (vsebnik) {
    vsebnik.scrollBy({ top: premik, behavior: "smooth" });
  } else {
    window.scrollBy({ top: premik, behavior: "smooth" });
  }
}

export function nacrtujPrikazPoljaNadPosTipkovnico(element: VnosnoPolje): () => void {
  let drugiOkvir = 0;
  const prviOkvir = window.requestAnimationFrame(() => {
    drugiOkvir = window.requestAnimationFrame(() => prikaziPoljeNadPosTipkovnico(element));
  });
  return () => {
    window.cancelAnimationFrame(prviOkvir);
    if (drugiOkvir) window.cancelAnimationFrame(drugiOkvir);
  };
}