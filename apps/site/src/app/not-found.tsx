import Link from "next/link";

export default function NotFound() {
  return (
    <div className="px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          Back to the front page
        </Link>
      </p>
    </div>
  );
}
