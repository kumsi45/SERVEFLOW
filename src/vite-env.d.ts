interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_APP_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_MENU_IMPORT_MAX_FILE_MB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css";
