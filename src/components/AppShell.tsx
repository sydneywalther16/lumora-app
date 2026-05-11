import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import StatusBar from './StatusBar';
import BottomNav from './BottomNav';

const routeTitles: Record<string, string> = {
  '/home': 'Lumora',
  '/for-you': 'For You',
  '/trends': 'For You',
  '/create': 'Create',
  '/capture': 'Capture',
  '/studio': 'Studio',
  '/inbox': 'Inbox',
  '/profile': 'Profile',
  '/diagnostics': 'Diagnostics',
  '/auth/callback': 'Signing in',
};

export default function AppShell() {
  const location = useLocation();

  useEffect(() => {
    console.info('NAV OK');
  }, []);

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
