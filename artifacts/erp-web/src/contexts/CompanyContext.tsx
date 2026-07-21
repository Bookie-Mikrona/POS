import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import type { CompanyWithRole } from "@workspace/api-client-react";

interface CompanyContextValue {
  activeCompany: CompanyWithRole | null;
  setActiveCompany: (company: CompanyWithRole | null) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

function storageKey(userId: string) {
  return `erp_active_company_${userId}`;
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const prevUserIdRef = useRef<string | null>(null);

  const [activeCompany, setActiveCompanyState] = useState<CompanyWithRole | null>(null);

  // Ko je Clerk naložen in poznamo userId, naložimo pravo shranjen izbor
  useEffect(() => {
    if (!isLoaded) return;

    const userId = user?.id ?? null;

    // Če se je uporabnik zamenjal (ali odjavil), počistimo aktivno podjetje
    if (prevUserIdRef.current !== null && prevUserIdRef.current !== userId) {
      setActiveCompanyState(null);
    }

    prevUserIdRef.current = userId;

    if (!userId) {
      setActiveCompanyState(null);
      return;
    }

    try {
      const stored = localStorage.getItem(storageKey(userId));
      if (stored) {
        const parsed = JSON.parse(stored) as CompanyWithRole;
        // POS podjetja nikoli ne shranjujemo kot activeCompany — to je ERP kontekst
        if ((parsed.role as string).startsWith("pos_")) {
          localStorage.removeItem(storageKey(userId));
          setActiveCompanyState(null);
        } else {
          setActiveCompanyState(parsed);
        }
      } else {
        setActiveCompanyState(null);
      }
    } catch {
      setActiveCompanyState(null);
    }
  }, [isLoaded, user?.id]);

  const setActiveCompany = (company: CompanyWithRole | null) => {
    setActiveCompanyState(company);
    const userId = user?.id;
    if (!userId) return;
    if (company) {
      localStorage.setItem(storageKey(userId), JSON.stringify(company));
    } else {
      localStorage.removeItem(storageKey(userId));
    }
  };

  return (
    <CompanyContext.Provider value={{ activeCompany, setActiveCompany }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
  return ctx;
}
