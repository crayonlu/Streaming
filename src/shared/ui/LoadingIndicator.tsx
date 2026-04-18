export function LoadingIndicator() {
  return (
    <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="text-xs">加载更多...</span>
    </div>
  );
}
