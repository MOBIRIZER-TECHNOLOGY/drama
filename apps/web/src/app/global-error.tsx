"use client";

import { colors } from "@/lib/tokens";

/**
 * The last-resort boundary: the root layout itself failed, so there is no app context, no translation
 * catalogue and no stylesheet — every colour and every string has to be carried by this file.
 *
 * It previously hardcoded hexes and the idiom "Katha hit a snag", in English only. This is the one page
 * guaranteed to be seen when things are at their worst, and showing a Hindi viewer an English idiom at that
 * moment is the worst place in the product to break its own promise. The colours now come from the shared
 * tokens, and the sentences from a small built-in table keyed on the language already in the URL.
 */
const STRINGS: Record<string, { title: string; body: string; retry: string }> = {
  en: { title: "Something went wrong", body: "The page could not be loaded. Please try again.", retry: "Try again" },
  hi: { title: "कुछ गड़बड़ हो गई", body: "यह पेज लोड नहीं हो सका। कृपया फिर से कोशिश करें।", retry: "फिर से कोशिश करें" },
  ta: { title: "ஏதோ தவறு நடந்துவிட்டது", body: "இந்தப் பக்கத்தை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.", retry: "மீண்டும் முயற்சி" },
  te: { title: "ఏదో పొరపాటు జరిగింది", body: "ఈ పేజీని లోడ్ చేయలేకపోయాము. దయచేసి మళ్లీ ప్రయత్నించండి.", retry: "మళ్లీ ప్రయత్నించండి" },
  bn: { title: "কিছু একটা ভুল হয়েছে", body: "পৃষ্ঠাটি লোড করা যায়নি। আবার চেষ্টা করুন।", retry: "আবার চেষ্টা করুন" },
  mr: { title: "काहीतरी चूक झाली", body: "हे पान लोड होऊ शकले नाही. कृपया पुन्हा प्रयत्न करा.", retry: "पुन्हा प्रयत्न करा" },
};

/** The URL is the only source of language left standing when the layout is gone. */
function langFromPath(): string {
  if (typeof window === "undefined") return "en";
  const first = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  return first in STRINGS ? first : "en";
}

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const lang = langFromPath();
  const s = STRINGS[lang] ?? STRINGS.en;
  return (
    <html lang={lang}>
      <body style={{ background: colors.ground, color: colors.ink, fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <div style={{ maxWidth: 480, margin: "15vh auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>{s.title}</h1>
          <p style={{ color: colors.muted, marginBottom: 20 }}>{s.body}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: colors.accent,
              color: colors.accentInk,
              border: 0,
              borderRadius: 999,
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {s.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
