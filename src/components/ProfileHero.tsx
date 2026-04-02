import { user } from '../data/mockData';

export default function ProfileHero() {
  return (
    <section className="profile-hero">
      <div className="avatar-glow">L</div>
      <div>
        <h2>{user.handle}</h2>
        <p>{user.bio}</p>
      </div>
      <div className="profile-stats">
        <div>
          <strong>{user.stats.followers}</strong>
          <span>Followers</span>
        </div>
        <div>
          <strong>{user.stats.following}</strong>
          <span>Following</span>
        </div>
        <div>
          <strong>{user.stats.likes}</strong>
          <span>Likes</span>
        </div>
      </div>
      <div className="tag-row">
        {user.signatureDNA.map((item) => (
          <span className="tag" key={item}>
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
