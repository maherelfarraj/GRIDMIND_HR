import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getActiveOrgId, setActiveOrgId } from '@/lib/org-fetch';

export interface Organization {
  id: number;
  orgCode: string;
  orgType: string;
  nameEn: string;
  nameAr: string;
  shortNameEn: string | null;
  shortNameAr: string | null;
  status: string;
  isDefault: boolean;
}

interface OrgContextType {
  orgs: Organization[];
  activeOrg: Organization | null;
  activeOrgId: number | null;
  switchOrg: (orgId: number) => void;
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<number | null>(getActiveOrgId());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/organizations')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: Organization[]) => {
        const active = data.filter((o) => o.status === 'active');
        setOrgs(active);
        // Initialize to the default org when nothing is stored yet
        const stored = getActiveOrgId();
        if (stored === null || !active.some((o) => o.id === stored)) {
          const def = active.find((o) => o.isDefault) ?? active[0] ?? null;
          if (def) {
            setActiveOrgId(def.id);
            setActiveOrgIdState(def.id);
          }
        }
      })
      .catch(() => setOrgs([]))
      .finally(() => setIsLoading(false));
  }, []);

  const switchOrg = (orgId: number) => {
    if (orgId === activeOrgId) return;
    setActiveOrgId(orgId);
    // Full reload: purges every query cache so all data reflects the new org
    window.location.reload();
  };

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, activeOrgId, switchOrg, isLoading }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
