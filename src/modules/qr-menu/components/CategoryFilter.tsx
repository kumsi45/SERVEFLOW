import type { MenuCategory } from "../types";

type CategoryFilterProps = {
  categories: MenuCategory[];
  activeCategoryId: string;
  onChange: (categoryId: string) => void;
};

export function CategoryFilter({
  categories,
  activeCategoryId,
  onChange,
}: CategoryFilterProps) {
  return (
    <nav className="category-filter" aria-label="Menu categories">
      <button
        className={activeCategoryId === "all" ? "category-pill active" : "category-pill"}
        type="button"
        onClick={() => onChange("all")}
      >
        <span>All</span>
      </button>
      {categories.map((category) => (
        <button
          className={activeCategoryId === category.id ? "category-pill active" : "category-pill"}
          key={category.id}
          type="button"
          onClick={() => onChange(category.id)}
        >
          <span>{category.name}</span>
        </button>
      ))}
    </nav>
  );
}
