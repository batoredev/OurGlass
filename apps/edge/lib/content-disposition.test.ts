import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("contentDisposition", () => {
  it("shows images inline and downloads everything else", () => {
    expect(contentDisposition("image", "poster.png")).toMatch(/^inline;/);
    expect(contentDisposition("pdf", "brief.pdf")).toMatch(/^attachment;/);
    expect(contentDisposition("docx", "brief.docx")).toMatch(/^attachment;/);
  });

  it("never lets an uploaded name break out of the header", () => {
    const header = contentDisposition("pdf", 'a"; filename="evil.html\r\nX-Injected: 1');
    expect(header).not.toMatch(/[\r\n]/);
    // The quoted fallback carries no raw quote to close it early, so the
    // injected `; filename=` stays INSIDE one quoted value.
    expect(header).toContain('filename="a_; filename=_evil.html__X-Injected: 1"; filename*=');
    expect(header.match(/"/g)).toHaveLength(2);
  });

  it("keeps the exact name in the RFC 5987 form", () => {
    expect(contentDisposition("text", "Café notes ✓.txt")).toContain(
      "filename*=UTF-8''Caf%C3%A9%20notes%20%E2%9C%93.txt",
    );
  });
});
