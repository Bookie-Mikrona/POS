import { useEffect, useState } from "react";

const MD_BREAKPOINT = 768;

/** true, ko je okno široko vsaj 768 px (ležeči telefon, tablica). Ne zahteva matchMedia. */
export function useSirokZaslon(): boolean {
  const [siroko, setSiroko] = useState(() => typeof window === "undefined" || window.innerWidth >= MD_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setSiroko(window.innerWidth >= MD_BREAKPOINT);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return siroko;
}
