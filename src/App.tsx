import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import HomePage from './pages/HomePage';
import TrendsPage from './pages/TrendsPage';
import CreatePage from './pages/CreatePage';
import CharacterCapturePage from './pages/CharacterCapturePage';
import StudioPage from './pages/StudioPage';
import InboxPage from './pages/InboxPage';
import ProfilePage from './pages/ProfilePage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import AuthResetConfirmPage from './pages/AuthResetConfirmPage';
import AuthUpdatePasswordPage from './pages/AuthUpdatePasswordPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import AccountDeletionPage from './pages/AccountDeletionPage';
import CommunityGuidelinesPage from './pages/CommunityGuidelinesPage';
import SupportPage from './pages/SupportPage';
import InstallPage from './pages/InstallPage';
import CreatorOnboarding from './components/CreatorOnboarding';
import { useSession } from './hooks/useSession';

export default function App() {
  const { authReady, configured } = useSession();

  if (configured && !authReady) {
    return (
      <div className="page lumora-page" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <section className="headline-card lumora-card lumora-card-hero" style={{ width: 'min(420px, 100%)', textAlign: 'center' }}>
          <span className="eyebrow">lumora</span>
          <h1 style={{ marginTop: '8px' }}>Restoring Lumora session...</h1>
        </section>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/for-you" element={<TrendsPage />} />
        <Route path="/trends" element={<Navigate to="/for-you" replace />} />
        <Route path="/onboarding" element={<CreatorOnboarding />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/capture" element={<CharacterCapturePage />} />
        <Route path="/drafts" element={<StudioPage />} />
        <Route path="/studio" element={<Navigate to="/drafts" replace />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/diagnostics" element={<DiagnosticsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/community-guidelines" element={<CommunityGuidelinesPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/account/delete" element={<AccountDeletionPage />} />
        <Route path="/install" element={<InstallPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/reset-confirm" element={<AuthResetConfirmPage />} />
        <Route path="/auth/update-password" element={<AuthUpdatePasswordPage />} />
      </Route>
    </Routes>
  );
}
