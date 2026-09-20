import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn 标准文本输入框。
 *
 * ⚠️ 目前**没有任何调用点** —— 全项目唯一真实存在的文本输入是顶栏搜索框
 * （`src/features/global-search/ui/GlobalSearch.tsx`）。它结构特殊（图标 + 下拉 +
 * 键盘导航，描边画在包裹的 `<form>` 上），不是这个组件的用法，所以没有收敛过来。
 * 改「输入框样式」时别改错文件：先确认你要改的是哪一个。
 *
 * 有意保留、也不手改：`components/ui/` 是 shadcn 的组件货架（`card.tsx` /
 * `dropdown-menu.tsx` 同样未被引用），保持贴近上游才能在需要时用 `shadcn add` 重新同步。
 *
 * 边界契约在 token 层而不是组件层：`--input` 保证 ≥3:1（由
 * `pnpm check:tokens` 的 BOUNDARY_CONTRAST 断言），所以无论谁来消费它都是安全的。
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-xs border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors duration-150 placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
