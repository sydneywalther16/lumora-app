import { useAppStore } from '../store/useAppStore';

export default function StudioList() {
  const { projects } = useAppStore();

  return (
    <section className="list-stack">
      {projects.map((project) => (
        <article className="list-card" key={project.id}>
          <div className="row-between">
            <h3>{project.title}</h3>
            <span className={`tiny-pill status-${project.status.toLowerCase()}`}>{project.status}</span>
          </div>
          <p>Smart clips, AI sequences, and export variations ready for publishing flow.</p>
          <div className="row-between muted-line">
            <span>Updated {project.updatedAt}</span>
            <button type="button" className="text-btn">
              Open project
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
