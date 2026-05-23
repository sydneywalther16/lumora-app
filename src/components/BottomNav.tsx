import { NavLink } from 'react-router-dom';
import { memo, useMemo } from 'react';

const items = [
  ['Home', '/home'],
  ['For You', '/for-you'],
  ['Create', '/create'],
  ['Drafts', '/drafts'],
  ['Inbox', '/inbox'],
  ['Profile', '/profile'],
] as const;

function navPillClass({ isActive }: { isActive: boolean }) {
  return `nav-pill ${isActive ? 'active' : ''}`;
}

function BottomNav() {
  const navItems = useMemo(() => items, []);

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {navItems.map(([label, to]) => (
        <NavLink
          key={to}
          to={to}
          className={navPillClass}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default memo(BottomNav);
