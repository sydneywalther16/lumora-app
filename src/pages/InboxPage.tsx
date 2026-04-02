import { inboxThreads } from '../data/mockData';

export default function InboxPage() {
  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">communications</span>
          <h2>Collabs, alerts, and brand interest</h2>
        </div>
        <p>A clean inbox for creator ops, product notifications, and trend updates.</p>
      </section>
      <section className="list-stack">
        {inboxThreads.map((thread) => (
          <article className="list-card" key={thread.id}>
            <div className="row-between">
              <h3>{thread.subject}</h3>
              {thread.unread ? <span className="tiny-dot" /> : <span className="muted">Read</span>}
            </div>
            <strong className="subline">From: {thread.from}</strong>
            <p>{thread.preview}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
