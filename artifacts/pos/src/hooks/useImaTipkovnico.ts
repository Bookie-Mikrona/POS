import { useEffect, useState } from "react";

function zaznaFizicnoTipkovnico(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(pointer: fine)").matches;
}

export function useImaTipkovnico(): boolean {
  const [ima, setIma] = useState(zaznaFizicnoTipkovnico);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const handler = (event: MediaQueryListEvent) => setIma(event.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return ima;
}