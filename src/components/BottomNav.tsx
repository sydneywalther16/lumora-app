import { NavLink } from 'react-router-dom';

const items = [
  ['Home', '/home'],
  ['Trends', '/trends'],
  ['Create', '/create'],
  ['Studio', '/studio'],
  ['Inbox', '/inbox'],
  ['Profile', '/profile'],
] as const;

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {items.map(([label, to]) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-pill ${isActive ? 'active' : ''}`}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
