import { describe, expect, it } from "vitest";
import { toSnakeKey } from "./snake-key.js";

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
