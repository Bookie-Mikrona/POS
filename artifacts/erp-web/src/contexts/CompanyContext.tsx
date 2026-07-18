import React, { createContext, useContext, useState, useEffect } from "react";
import type { CompanyWithRole } from "@workspace/api-client-react";

interface CompanyContextValue {
  activeCompany: CompanyWithRole | null;
  setActiveCompany: (company: CompanyWithRole | null) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const [activeCompany, setActiveCompanyState] = useState<CompanyWithRole | null>(() => {
    try {
      const stored = localStorage.getItem("erp_active_company");
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const setActiveCompany = (company: CompanyWithRole | null) => {
    setActiveCompanyState(company);
    if (company) localStorage.setItem("erp_active_company", JSON.stringify(company));
    else localStorage.removeItem("erp_active_company");
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