import { useEffect, useState } from 'react';
import { loadBlockedCreators, unblockCreator, type BlockedCreator } from '../lib/accountSafety';

export default function BlockedCreatorsPanel() {
  const [creators, setCreators] = useState<BlockedCreator[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadBlockedCreators()
      .then((items) => active && setCreators(items))
      .catch((error) => active && setMessage(error instanceof Error ? error.message : 'Blocked creators could not be loaded.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function handleUnblock(creator: BlockedCreator) {
    if (!window.confirm(`Unblock ${creator.displayName}? Their public content can appear again.`)) return;
    try {
      await unblockCreator(creator.userId);
      setCreators((current) => current.filter((item) => item.userId !== creator.userId));
      setMessage(`${creator.displayName} was unblocked.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The creator could not be unblocked.');
    }
  }

  return (
    <section className="headline-card lumora-card compact">
      <div>
        <span className="eyebrow">content controls</span>
        <h2>Blocked creators</h2>
      </div>
      {loading ? <p className="muted">Loading blocked creators...</p> : null}
      {!loading && !creators.length ? <p className="muted">You have not blocked any creators.</p> : null}
      {creators.map((creator) => (
        <div className="blocked-creator-row" key={creator.userId}>
          <div>
            <strong>{creator.displayName}</strong>
            {creator.username ? <span className="muted">@{creator.username}</span> : null}
          </div>
          <button type="button" className="ghost-btn" onClick={() => void handleUnblock(creator)}>Unblock</button>
        </div>
      ))}
      {message ? <p className="content-safety-message">{message}</p> : null}
    </section>
  );
}
