import { AuthProvider } from "@/lib/auth";
import { Shell } from "@/components/shell";

export default function AdminLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
