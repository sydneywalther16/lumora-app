type Props = { title: string };

export default function StatusBar({ title }: Props) {
  return (
    <header className="status-bar">
      <div>
        <div className="eyebrow">beta preview</div>
        <h1>{title}</h1>
      </div>
      <div className="status-icons">
        <span>5G</span>
        <span>89%</span>
      </div>
    </header>
  );
}
