import { RouterProvider } from "react-router-dom";
import { AppProviders } from "./app/providers/AppProviders";
import { appRouter } from "./app/router";
import { ErrorBoundary } from "./shared/ui/ErrorBoundary";

function App() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={appRouter} />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;
