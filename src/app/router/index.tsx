import { lazy, Suspense } from "react";
import { createBrowserRouter, useLocation } from "react-router-dom";
import { AppShell } from "@/app/layout/AppShell";
import { DiscoverPage } from "@/pages/discover/DiscoverPage";
import { FollowsPage } from "@/pages/follows/FollowsPage";
import { SearchPage } from "@/pages/search/SearchPage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { ErrorBoundary } from "@/shared/ui/ErrorBoundary";
import { StatusView } from "@/shared/ui/StatusView";

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
            <Suspense fallback={<StatusView title="播放器加载中" tone="loading" />}>
              <PlayerPage />
            </Suspense>
          </RouteErrorBoundary>
        ),
      },
      {
        path: "replay/:platform/:roomId",
        element: (
          <RouteErrorBoundary>
            <Suspense fallback={<StatusView title="录播加载中" tone="loading" />}>
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
        element: <StatusView title="页面不存在" hint="请检查地址是否正确" tone="empty" />,
      },
    ],
  },
]);
