import { notFound } from "next/navigation";

/** Any unmatched path under /[lang] renders the localised not-found page. */
export default function CatchAll() {
  notFound();
}
