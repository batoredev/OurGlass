"use client";

/**
 * Thoughts — ideas and goals, by priority, as a board you can rearrange.
 */
import { AsyncPage } from "../async-page";
import { fetchThoughts, type Thought } from "../../lib/api";
import { LoadFailure, PageHeader } from "../surface";
import { ThoughtsBoard } from "./board";

async function renderThoughts() {
  let thoughts: readonly Thought[];
  try {
    thoughts = await fetchThoughts();
  } catch (error: unknown) {
    return (
      <section className="page">
        <PageHeader title="Thoughts" />
        <LoadFailure error={error} />
      </section>
    );
  }
  return (
    <section className="page">
      <PageHeader
        title="Thoughts"
        eyebrow="Ideas to action"
        subtitle="Capture an idea or goal, then drag it between High, Mid and Low as priorities change."
      />
      <ThoughtsBoard initial={thoughts} />
    </section>
  );
}

export default function ThoughtsPage() {
  return <AsyncPage render={renderThoughts} />;
}
