type Props = {
  items: readonly string[];
  activeItem: string;
  onSelect: (item: string) => void;
};

export default function TopChips({ items, activeItem, onSelect }: Props) {
  return (
    <div className="chip-row">
      {items.map((item) => (
        <button
          aria-pressed={activeItem === item}
          className={`chip ${activeItem === item ? 'active' : ''}`}
          key={item}
          type="button"
          onClick={() => onSelect(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
