import { BrowserRouter, Route, Routes } from "react-router-dom";
import { PortalShell } from "@/components/portal/portal-shell";
import { AssetDetailPage } from "@/pages/asset-detail";
import { FaucetPage } from "@/pages/faucet";
import { LandingPage } from "@/pages/landing";
import { OfferingsPage } from "@/pages/offerings";

/**
 * The app router.
 *
 * `/` stays the concept landing page; the portal adds `/offerings` and `/assets/:slug` under a
 * shared shell (top navigation, chain switch, wallet control). Chain state lives in the
 * `ChainProvider` (see `components/providers.tsx`), so every portal screen reads the same chain.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route element={<PortalShell />}>
          <Route path="/offerings" element={<OfferingsPage />} />
          <Route path="/faucet" element={<FaucetPage />} />
          <Route path="/assets/:slug" element={<AssetDetailPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
