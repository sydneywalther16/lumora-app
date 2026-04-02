import { Outlet, useLocation } from 'react-router-dom';
import StatusBar from './StatusBar';
import BottomNav from './BottomNav';

const routeTitles: Record<string, string> = {
  '/home': 'Lumora',
  '/trends': 'Trend Radar',
  '/create': 'Create',
  '/studio': 'Studio',
  '/inbox': 'Inbox',
  '/profile': 'Profile',
};

export default function AppShell() {
  const location = useLocation();
  return (
    <div className="app-bg">
      <div className="phone-frame">
        <StatusBar title={routeTitles[location.pathname] ?? 'Lumora'} />
        <main className="screen-scroll">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
