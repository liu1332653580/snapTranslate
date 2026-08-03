import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Toaster() {
  const toast = useAppStore((s) => s.toast);
  const clearToast = useAppStore((s) => s.clearToast);
  if (!toast) return null;

  const Icon =
    toast.variant === "success"
      ? CheckCircle2
      : toast.variant === "error"
        ? AlertCircle
        : Info;

  return (
    <div className="fixed bottom-6 right-6 z-[100] animate-slide-up">
      <div
        onClick={clearToast}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 shadow-xl backdrop-blur",
          toast.variant === "success" && "border-primary/40 bg-primary/10",
          toast.variant === "error" && "border-destructive/40 bg-destructive/10",
          toast.variant === "info" && "border-border bg-card",
        )}
      >
        <Icon
          size={18}
          className={
            toast.variant === "success"
              ? "text-primary"
              : toast.variant === "error"
                ? "text-destructive"
                : "text-muted-foreground"
          }
        />
        <span className="text-sm">{toast.message}</span>
      </div>
    </div>
  );
}
