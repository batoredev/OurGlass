import { describe, expect, it } from "vitest";
import { singularTypeKey, toSnakeKey } from "./snake-key.js";

describe("singularTypeKey", () => {
  it("makes the plural and singular names of one tracker the same key", () => {
    // Live qwen3:8b keyed the same sentence `plants` and then `plant`, and a
    // duplicate tracker was created. The owner's real tracker is gym_sessions.
    expect(singularTypeKey("plants")).toBe(singularTypeKey("plant"));
    expect(singularTypeKey("gym_sessions")).toBe("gym_session");
    expect(singularTypeKey("gymSession")).toBe("gym_session");
    expect(singularTypeKey("diaries")).toBe("diary");
  });

  it("leaves words that are not plurals alone, so different trackers never collide", () => {
    expect(singularTypeKey("glass")).toBe("glass");
    expect(singularTypeKey("status")).toBe("status");
    expect(singularTypeKey("analysis")).toBe("analysis");
    expect(singularTypeKey("gas")).toBe("gas");
    expect(singularTypeKey("book")).not.toBe(singularTypeKey("booking"));
  });
});

describe("toSnakeKey", () => {
  it("converts what a local model actually wrote", () => {
    // Live qwen3:8b output for "track my reading with a book title and pages
    // read". Before this, both keys failed the tool's snake_case check.
    expect(toSnakeKey("bookTitle")).toBe("book_title");
    expect(toSnakeKey("pagesRead")).toBe("pages_read");
  });

  it("converts labels, kebab-case and stray whitespace", () => {
    expect(toSnakeKey("Book Title")).toBe("book_title");
    expect(toSnakeKey("book-title")).toBe("book_title");
    expect(toSnakeKey("  session date ")).toBe("session_date");
    expect(toSnakeKey("HTTPStatus")).toBe("http_status");
  });

  it("leaves a key that is already snake_case alone", () => {
    // What Claude writes. Normalising must be a no-op on the verified path.
    expect(toSnakeKey("gym_session")).toBe("gym_session");
    expect(toSnakeKey("session_date")).toBe("session_date");
  });
});
