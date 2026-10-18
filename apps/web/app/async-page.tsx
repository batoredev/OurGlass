"use client";

/**
 * Renders a page whose content is loaded in the browser.
 *
 * The pages were async server components: they awaited the API, then
 * returned JSX. On a static site there is no server to await on, so each
 * page's body became a plain async `render()` function and this component
 * runs it after mount — and again whenever `refreshData()` fires, which is
 * what `router.refresh()` used to do for server components.
 */
import { useEffect, useState, type ReactNode } from "react";
import { REFRESH_EVENT } from "../lib/session";
import { LoadFailure } from "./surface";

export function AsyncPage({ render }: { render: () => Promise<ReactNode> }) {
  const [node, setNode] = useState<ReactNode>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      render().then(
        (result) => {
          if (live) setNode(result);
        },
        (error: unknown) => {
          if (live) {
            setNode(
              <section className="page page-narrow">
                <LoadFailure error={error} />
              </section>,
            );
          }
        },
      );
    };
    load();
    window.addEventListener(REFRESH_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(REFRESH_EVENT, load);
    };
  }, [render]);

  return node ?? <section className="page page-narrow" aria-busy="true" />;
}
