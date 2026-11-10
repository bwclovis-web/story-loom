import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="workspace site">
      <h1>Not found</h1>
      <p>
        This page does not exist, or the project or record has a different ID in this database.{" "}
        <Link href="/">Back to workspaces</Link>
      </p>
    </main>
  );
}
