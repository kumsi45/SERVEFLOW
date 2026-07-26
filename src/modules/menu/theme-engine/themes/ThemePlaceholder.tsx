import type { ThemeRendererProps } from "../ThemeTypes";

export function ThemePlaceholder({ name }: { name: string }) {
  return (
    <main className="menu-theme-placeholder" data-theme-direction="logical">
      <section aria-labelledby="menu-theme-placeholder-title">
        <span>ServeFlow Menu Theme</span>
        <h1 id="menu-theme-placeholder-title">{name}</h1>
        <p>Coming Soon</p>
      </section>
    </main>
  );
}

export type PlaceholderThemeProps = ThemeRendererProps;
