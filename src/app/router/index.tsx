import { lazy, Suspense } from "react";
import { createBrowserRouter, useLocation } from "react-router-dom";
import { AppShell } from "@/app/layout/AppShell";
import { DiscoverPage } from "@/pages/discover/DiscoverPage";
import { FollowsPage } from "@/pages/follows/FollowsPage";
import { SearchPage } from "@/pages/search/SearchPage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { StatusView } from "@/shared/ui/StatusView";
import { useStrings } from "@/shared/i18n";

const PlayerPage = lazy(() =>
  import("@/pages/player/PlayerPage").then((m) => ({ default: m.PlayerPage })),
);

const ReplayPage = lazy(() =>
  import("@/pages/replay/ReplayPage").then((m) => ({ default: m.ReplayPage })),
);

/**
 * Thin wrapper that reads the current pathname and passes it as `resetKey`
 * to ErrorBoundary, so the error state clears automatically when the user
 * navigates away and back.
 */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

// The route table is built once at module load, so the copy it needs has to be
// read inside components rather than at that point.
function PlayerLoading() {
  return <StatusView title={useStrings().route.playerLoading} tone="loading" />;
}

function ReplayLoading() {
  return <StatusView title={useStrings().route.replayLoading} tone="loading" />;
}

function NotFound() {
  const s = useStrings();
  return <StatusView title={s.route.pageNotFound} hint={s.route.pageNotFoundHint} tone="empty" />;
}

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: (
          <RouteErrorBoundary>
            <DiscoverPage />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "search",
        element: (
          <RouteErrorBoundary>
            <SearchPage />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "follows",
        element: (
          <RouteErrorBoundary>
            <FollowsPage />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "player/:platform/:roomId",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<PlayerLoading />}>
              <PlayerPage />
            </Suspense>
          </RouteErrorBoundary>
        ),
      },
      {
        path: "replay/:platform/:roomId",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<ReplayLoading />}>
              <ReplayPage />
            </Suspense>
          </RouteErrorBoundary>
        ),
      },
      {
        path: "settings",
        element: (
          <RouteErrorBoundary>
            <SettingsPage />
          </RouteErrorBoundary>
        ),
      },
      {
        path: "*",
        element: <NotFound />,
      },
    ],
  },
]);
