import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
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

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <DiscoverPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "follows", element: <FollowsPage /> },
      {
        path: "player/:platform/:roomId",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<StatusView title="播放器加载中" tone="loading" />}>
              <PlayerPage />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      {
        path: "replay/:platform/:roomId",
        element: (
          <ErrorBoundary>
            <Suspense fallback={<StatusView title="录播加载中" tone="loading" />}>
              <ReplayPage />
            </Suspense>
          </ErrorBoundary>
        ),
      },
      { path: "settings", element: <SettingsPage /> },
      {
        path: "*",
        element: <StatusView title="页面不存在" hint="请检查地址是否正确" tone="empty" />,
      },
    ],
  },
]);
