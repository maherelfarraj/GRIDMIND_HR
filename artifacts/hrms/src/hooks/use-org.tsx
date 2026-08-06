import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getActiveOrgId, setActiveOrgId } from '@/lib/org-fetch';
import { useAuthMaybe } from '@/hooks/use-auth';

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
  canSwitchOrg: boolean;
  isLoading: boolean;
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const auth = useAuthMaybe();
  const user = auth?.user ?? null;
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<number | null>(getActiveOrgId());
  const [isLoading, setIsLoading] = useState(true);

  // Whether this user may cross org boundaries (system-role flag from the server).
  const canSwitchOrg = user?.canSwitchOrg === true;

  useEffect(() => {
    fetch('/api/organizations')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: Organization[]) => {
        const active = data.filter((o) => o.status === 'active');
        setOrgs(active);

        // Determine the correct active org:
        // 1. Non-switchers are always locked to their home org from the server.
        // 2. Switchers keep whatever is stored unless it's no longer a valid org.
        if (!canSwitchOrg && user?.orgId != null) {
          // Force home org — never trust localStorage for restricted users.
          setActiveOrgId(user.orgId);
          setActiveOrgIdState(user.orgId);
        } else {
          const stored = getActiveOrgId();
          // Prefer home org from the server when nothing is stored yet.
          const homeOrgId = user?.orgId ?? null;
          if (stored !== null && active.some((o) => o.id === stored)) {
            // Stored value is still valid — keep it.
            setActiveOrgIdState(stored);
          } else {
            // Fall back: home org, then default, then first.
            const fallback =
              (homeOrgId != null ? active.find((o) => o.id === homeOrgId) : null) ??
              active.find((o) => o.isDefault) ??
              active[0] ??
              null;
            if (fallback) {
              setActiveOrgId(fallback.id);
              setActiveOrgIdState(fallback.id);
            }
          }
        }
      })
      .catch(() => setOrgs([]))
      .finally(() => setIsLoading(false));
  // Re-run whenever the signed-in user changes so org context tracks session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, canSwitchOrg]);

  const switchOrg = (orgId: number) => {
    if (!canSwitchOrg) return; // no-op for restricted users
    if (orgId === activeOrgId) return;
    setActiveOrgId(orgId);
    // Full reload: purges every query cache so all data reflects the new org
    window.location.reload();
  };

  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;

  return (
    <OrgContext.Provider value={{ orgs, activeOrg, activeOrgId, switchOrg, canSwitchOrg, isLoading }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
