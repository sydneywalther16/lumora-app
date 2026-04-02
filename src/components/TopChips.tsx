type Props = {
  items: string[];
};

export default function TopChips({ items }: Props) {
  return (
    <div className="chip-row">
      {items.map((item, index) => (
        <button className={`chip ${index === 0 ? 'active' : ''}`} key={item} type="button">
          {item}
        </button>
      ))}
    </div>
  );
}
