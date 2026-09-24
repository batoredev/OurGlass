import { describe, expect, it } from "vitest";
import { isQuestion, namedFieldCount } from "./write-guards.js";

describe("isQuestion", () => {
  it("catches the questions a model filed as statements", () => {
    // Live qwen3:8b: information + newStatus "blocked" from this sentence.
    expect(isQuestion("What's blocked right now?")).toBe(true);
    // The model often quotes the span without its question mark.
    expect(isQuestion("What's blocked right now")).toBe(true);
    expect(isQuestion("Who owes me the deck")).toBe(true);
    expect(isQuestion("Is Karthik blocked on the schema?")).toBe(true);
    expect(isQuestion("Has Barkha sent the article?")).toBe(true);
  });

  it("lets statements and polite instructions through — they should write", () => {
    expect(isQuestion("Barkha owes me the article by 6")).toBe(false);
    expect(isQuestion("Could you note that Barkha owes me the article?")).toBe(false);
    expect(isQuestion("Can you remind me at 5?")).toBe(false);
    // An auxiliary opener without a question mark is not enough on its own.
    expect(isQuestion("Have Barkha send me the article by Friday")).toBe(false);
    expect(isQuestion("")).toBe(false);
  });
});

describe("namedFieldCount", () => {
  const field = (fieldKey: string, label: string) => ({ fieldKey, label });

  it("counts fields the user actually said, however the model spelled them", () => {
    expect(
      namedFieldCount([field("date", "Date"), field("duration", "Duration")], "Track my gym sessions with a date and a duration"),
    ).toBe(2);
    // camelCase key, as qwen3:8b writes it, against the user's words.
    expect(
      namedFieldCount(
        [field("bookTitle", "Book Title"), field("pagesRead", "Pages Read")],
        "Track my reading with a book title and pages read",
      ),
    ).toBe(2);
    expect(namedFieldCount([field("gym", "Gym")], "Also track which gym I went to")).toBe(1);
    expect(
      namedFieldCount([field("finished", "Finished")], "Start tracking books I read, with a title and whether I finished it"),
    ).toBe(1);
  });

  it("counts zero for a schema the model invented", () => {
    // Live qwen3:8b for "Add Dune to my books, finished." — a new tracker with
    // fields nobody named.
    expect(namedFieldCount([field("title", "Title"), field("status", "Status")], "Add Dune to my books, finished.")).toBe(0);
    expect(namedFieldCount([field("type", "Type"), field("status", "Status")], "Keep track of the Hult poster for me.")).toBe(0);
  });

  it("tolerates a plural either way", () => {
    expect(namedFieldCount([field("note", "Note")], "Track my gym sessions with notes")).toBe(1);
    expect(namedFieldCount([field("ratings", "Ratings")], "Add a rating to my reading")).toBe(1);
  });
});
