/**
 * An unknown route. Next's default 404 names the framework; this names the
 * way back.
 */
import Link from "next/link";
import { Page } from "./ui";

export default function NotFound() {
  return (
    <Page title="Nothing here">
      <p>
        There&apos;s no page at this address. <Link href="/">Back to the chat</Link>
      </p>
    </Page>
  );
}
