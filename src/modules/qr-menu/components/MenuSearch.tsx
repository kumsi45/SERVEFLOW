type MenuSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

export function MenuSearch({ value, onChange }: MenuSearchProps) {
  return (
    <label className="menu-search">
      <span>Search</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search food or drinks..."
      />
    </label>
  );
}
