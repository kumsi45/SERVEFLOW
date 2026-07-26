export function SearchBar({ value, onChange, placeholder = "Search menu" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="menu-theme-search"><span className="sr-only">Search menu</span><input type="search" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}
