import { CategoryFilter } from "../components/CategoryFilter";
import { MenuGroup } from "../components/MenuGroup";
import { MenuSearch } from "../components/MenuSearch";
import { RestaurantHeader } from "../components/RestaurantHeader";
import { useQRMenu } from "../hooks/useQRMenu";

type QRMenuPageProps = {
  restaurantSlug: string;
};

export function QRMenuPage({ restaurantSlug }: QRMenuPageProps) {
  const {
    restaurant,
    categories,
    groups,
    activeCategoryId,
    searchTerm,
    loading,
    error,
    setActiveCategoryId,
    setSearchTerm,
  } = useQRMenu(restaurantSlug);

  if (loading) {
    return (
      <main className="qr-menu-page">
        <section className="menu-state">Loading menu...</section>
      </main>
    );
  }

  if (error || !restaurant) {
    return (
      <main className="qr-menu-page">
        <section className="menu-state">
          <h1>Menu unavailable</h1>
          <p>{error || "This restaurant menu could not be loaded."}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="qr-menu-page">
      <RestaurantHeader restaurant={restaurant} />
      <section className="menu-controls">
        <MenuSearch value={searchTerm} onChange={setSearchTerm} />
        <CategoryFilter
          categories={categories}
          activeCategoryId={activeCategoryId}
          onChange={setActiveCategoryId}
        />
      </section>
      <section className="menu-content">
        {groups.length > 0 ? (
          groups.map((group) => <MenuGroup group={group} key={group.category.id} />)
        ) : (
          <div className="menu-state">No matching menu items.</div>
        )}
      </section>
    </main>
  );
}
