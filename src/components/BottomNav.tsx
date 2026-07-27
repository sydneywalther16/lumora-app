import { NavLink } from 'react-router-dom';
import { memo } from 'react';

const items = [
  ['Home', '/home'],
  ['Discover', '/for-you'],
  ['Create', '/create'],
  ['Drafts', '/drafts'],
  ['Profile', '/profile'],
] as const;

function navPillClass({ isActive }: { isActive: boolean }) {
  return `nav-pill ${isActive ? 'active' : ''}`;
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map(([label, to]) => (
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
