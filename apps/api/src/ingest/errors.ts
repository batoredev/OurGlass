/**
 * A file that was accepted by type but could not be turned into text.
 *
 * The reason is written for the user: it becomes the reply. It never carries
 * the parser's own error text, which can quote the file's bytes.
 */
export type UnreadableReason = "damaged" | "password_protected" | "too_large";

const MESSAGES: Readonly<Record<UnreadableReason, string>> = {
  damaged: "the file looks damaged",
  password_protected: "it's password-protected",
  too_large: "it unpacks to more than I'll read",
};

export class UnreadableFileError extends Error {
  readonly reason: UnreadableReason;

  constructor(reason: UnreadableReason) {
    super(MESSAGES[reason]);
    this.name = "UnreadableFileError";
    this.reason = reason;
  }
}
