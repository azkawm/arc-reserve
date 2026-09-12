/// <reference types="vite/client" />

/**
 * The configured surface of the app, typed.
 *
 * Every variable is optional on purpose. `VITE_API_URL` absent is a *supported mode* — the app
 * runs on fixtures and every panel badges itself `Mock` (D-019) — so the types must not pretend
 * these are guaranteed. Note that Vite inlines these at build time, which is why the Docker
 * image takes them as build arguments rather than runtime environment.
 */
interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_MUSD_ADDRESS?: string;
  readonly VITE_REGISTRY_ADDRESS?: string;
  readonly VITE_TOKEN_ADDRESS?: string;
  readonly VITE_VAULT_ADDRESS?: string;
  readonly VITE_OFFERING_ADDRESS?: string;
  readonly VITE_MARKET_MANAGER_ADDRESS?: string;
  readonly VITE_REVENUE_DISTRIBUTOR_ADDRESS?: string;
  readonly VITE_REDEMPTION_CONTROLLER_ADDRESS?: string;
  readonly VITE_ASSET_ID?: string;
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
