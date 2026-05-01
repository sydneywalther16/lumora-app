import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import HomePage from './pages/HomePage';
import TrendsPage from './pages/TrendsPage';
import CreatePage from './pages/CreatePage';
import CharacterCapturePage from './pages/CharacterCapturePage';
import StudioPage from './pages/StudioPage';
import InboxPage from './pages/InboxPage';
import ProfilePage from './pages/ProfilePage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/trends" element={<TrendsPage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/capture" element={<CharacterCapturePage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
}
