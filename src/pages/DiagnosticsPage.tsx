import { useEffect, useState } from 'react';
import { api, type ApiHealthDiagnostics } from '../lib/api';

export default function DiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<ApiHealthDiagnostics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadDiagnostics() {
      setLoading(true);
      setError('');
      try {
        const result = await api.healthDiagnostics();
        if (active) setDiagnostics(result);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load API diagnostics.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDiagnostics();

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="page">
      <section className="headline-card compact">
        <span className="eyebrow">api</span>
        <h2>Diagnostics</h2>
        <p>Provider readiness, storage wiring, and deployment environment checks.</p>
      </section>

      <section className="editor-card">
        {loading ? <p className="muted">Checking API health...</p> : null}
        {error ? <p style={{ color: 'var(--error-text)' }}>{error}</p> : null}
        {diagnostics ? (
          <div className="diagnostics-grid">
            <div>
              <span className="eyebrow">status</span>
              <strong>{diagnostics.ok ? 'Ready' : 'Needs env setup'}</strong>
              <p className="muted">{diagnostics.service} · {diagnostics.mode}</p>
            </div>
            <div>
              <span className="eyebrow">configured</span>
              {Object.entries(diagnostics.configured).map(([key, ready]) => (
                <p key={key} className="diagnostic-row">
                  <span>{key}</span>
                  <strong>{ready ? 'OK' : 'Missing'}</strong>
                </p>
              ))}
            </div>
            <div>
              <span className="eyebrow">providers</span>
              {diagnostics.generationProviders.map((provider) => (
                <p key={provider.id} className="diagnostic-row">
                  <span>{provider.id}</span>
                  <strong>{provider.status}</strong>
                </p>
              ))}
            </div>
            {diagnostics.database ? (
              <div>
                <span className="eyebrow">database</span>
                <p className="diagnostic-row">
                  <span>service role</span>
                  <strong>{diagnostics.database.serviceRoleConfigured ? 'OK' : 'Missing'}</strong>
                </p>
                {diagnostics.database.tables.map((table) => (
                  <p key={table.table} className="diagnostic-row">
                    <span>{table.table}</span>
                    <strong>{table.ok ? 'OK' : 'Error'}</strong>
                  </p>
                ))}
                <p className="diagnostic-row">
                  <span>RLS policies</span>
                  <strong>{diagnostics.database.rlsPolicies.ok ? 'OK' : 'Unavailable'}</strong>
                </p>
              </div>
            ) : null}
            {diagnostics.missingRecommended.length ? (
              <div className="generation-warning-list">
                {diagnostics.missingRecommended.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
