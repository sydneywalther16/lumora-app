import AuthCard from '../components/auth/AuthCard';
import ProfileHero from '../components/ProfileHero';
import StudioList from '../components/StudioList';

export default function ProfilePage() {
  return (
    <div className="page">
      <AuthCard />
      <ProfileHero />
      <section className="headline-card compact">
        <div>
          <span className="eyebrow">signature workflow</span>
          <h2>Recent outputs</h2>
        </div>
      </section>
      <StudioList />
    </div>
  );
}
