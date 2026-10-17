// Texts made of fixed wording and variable values, so the values can be shown emphasized:
// ["Sent ", { value: "4.2 KB" }, " to ", { value: "fingerprint.com" }].

export type TextPart = string | { value: string };
