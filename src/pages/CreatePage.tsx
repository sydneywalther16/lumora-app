import PromptEditor from '../components/PromptEditor';

export default function CreatePage() {
  return (
    <div className="page">
      <section className="headline-card">
        <div>
          <span className="eyebrow">composer</span>
          <h2>Build the next viral persona moment</h2>
        </div>
        <p>Prompt-first workflow with style presets, title drafting, and one-tap project saving.</p>
      </section>
      <PromptEditor />
    </div>
  );
}
