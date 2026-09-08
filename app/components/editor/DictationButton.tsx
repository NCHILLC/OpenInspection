import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton, Icon } from "@core/shared-ui";
import { haptic, HAPTIC_TAP } from "~/lib/haptics";
import { m } from "~/paraglide/messages";

/* Minimal shape of the Web Speech API this component actually uses — the
 * spec's own lib.dom types are not shipped, and the full interface (grammars,
 * alternatives, service URIs) is not needed for one-utterance dictation. */
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface DictationButtonProps {
  value: string;
  onChange: (next: string) => void;
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * A mic trigger for a text field (field eval P1 — no dictation trigger
 * anywhere in the mobile tree; comment in FooterBar.tsx confirms one was
 * listed and never built).
 *
 * Where the Web Speech API exists (Chrome/Android — the field-inspection
 * majority), tapping starts listening and inserts the recognized utterance at
 * the caret. Where it does not (iOS Safari has never shipped
 * SpeechRecognition), tapping just focuses the field — the OS keyboard's own
 * mic button is then one tap away, which is the affordance this replaces
 * having to discover.
 */
export function DictationButton({ value, onChange, targetRef, size = "lg", className = "" }: DictationButtonProps) {
  const supported = getSpeechRecognitionCtor() != null;
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Stop a live session on unmount (item navigated away mid-dictation).
  useEffect(() => () => recognitionRef.current?.stop(), []);

  const insert = useCallback(
    (text: string) => {
      const el = targetRef.current;
      const caret = el?.selectionStart ?? value.length;
      const priorChar = value[caret - 1];
      const withSpace = caret > 0 && priorChar !== undefined && !/\s/.test(priorChar) ? ` ${text}` : text;
      const next = value.slice(0, caret) + withSpace + value.slice(caret);
      onChange(next);
      const pos = caret + withSpace.length;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(pos, pos);
      });
    },
    [value, onChange, targetRef],
  );

  const stop = useCallback(() => {
    // Clear the ref and the instance's own handlers BEFORE calling .stop() —
    // some engines fire onend synchronously from inside stop(), and onend is
    // this same function, which would otherwise re-enter it.
    const r = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    if (r) {
      r.onend = null;
      r.onerror = null;
      r.stop();
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      // No engine in this browser (iOS Safari) — the OS keyboard's own mic
      // is one tap away once the field is focused.
      targetRef.current?.focus();
      return;
    }
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) insert(transcript);
    };
    recognition.onerror = stop;
    recognition.onend = stop;
    recognitionRef.current = recognition;
    setListening(true);
    haptic(HAPTIC_TAP);
    recognition.start();
  }, [insert, stop, targetRef]);

  return (
    <IconButton
      size={size}
      variant="secondary"
      selected={supported ? listening : undefined}
      aria-label={listening ? m.editor_dictation_stop_aria() : m.editor_dictation_start_aria()}
      data-testid="dictation-button"
      onClick={() => (listening ? stop() : start())}
      className={className}
    >
      <Icon name="mic" size={size === "sm" ? 14 : 18} />
    </IconButton>
  );
}
