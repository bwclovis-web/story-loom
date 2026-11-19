import { PageEnter } from "@/components/shell/PageEnter";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="workspace site">
      <PageEnter>{children}</PageEnter>
    </main>
  );
}
