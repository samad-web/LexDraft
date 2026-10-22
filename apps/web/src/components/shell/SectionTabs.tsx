import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PillNav } from '@/components/PillNav';
import { useMeFeatures } from '@/hooks/useFirmAdmin';
import { pathMatches, sectionForPath, visibleNavGroups } from './nav-config';

/**
 * Tab strip for sidebar entries that group several pages (Hearings,
 * Documents, People & Roles, ...). Rendered once by the app shell above the
 * routed page, so the grouped pages need no changes of their own. Hidden when
 * the user can only open one of the tabs.
 */
export function SectionTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const meFeatures = useMeFeatures();

  const section = useMemo(
    () => sectionForPath(visibleNavGroups(meFeatures.data?.features ?? []), location.pathname),
    [meFeatures.data, location.pathname],
  );
  const tabs = section?.tabs;
  if (!section || !tabs || tabs.length < 2) return null;

  const active = tabs.find((t) => pathMatches(location.pathname, t.to)) ?? tabs[0]!;

  return (
    <div className="section-tabs">
      <PillNav
        items={tabs.map((t) => ({ id: t.to, label: t.label }))}
        value={active.to}
        onChange={(to) => navigate(to)}
        ariaLabel={`${section.label} sections`}
      />
    </div>
  );
}
