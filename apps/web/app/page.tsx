/**
 * The home surface IS the conversation (§29).
 *
 * It used to be a note explaining that the conversation view did not exist and
 * pointing at a `curl` command. It exists now.
 */
import { Conversation } from "./conversation";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <Conversation />;
}
