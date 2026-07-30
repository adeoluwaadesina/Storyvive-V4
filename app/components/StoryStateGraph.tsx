"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type StoryStateCharacter = { name: string; status?: string; location?: string; notes?: string };
export type StoryStateLike = { characters: StoryStateCharacter[]; unresolvedThreads: string[] };

type NodeStatus = "alive" | "gone" | "unresolved";

function classify(status?: string): NodeStatus {
  const s = (status ?? "").toLowerCase();
  if (/dead|gone|kill|deceas|missing|captur|lost/.test(s)) return "gone";
  if (/alive|free|safe|well|active/.test(s)) return "alive";
  return "unresolved";
}

const COLOR: Record<NodeStatus, string> = {
  alive: "#2c5fe0",
  gone: "#c1483a",
  unresolved: "#b9bec4",
};

const EXIT_MS = 900;
const ENTER_MS = 500;

/**
 * A small node-graph visualizing a story's state (who's tracked, and whether
 * they're alive/gone/unresolved) as characters orbiting a central hub. Pass
 * `previousState` only when this is the state for a chapter that was just
 * generated — it drives a one-time enter/exit animation (characters who
 * dropped out "disintegrate", new ones fade in) representing what changed in
 * the chapter immediately before this one, which the reader has already seen.
 */
export default function StoryStateGraph({
  state,
  previousState,
}: {
  state: StoryStateLike;
  previousState?: StoryStateLike;
}) {
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const [entering, setEntering] = useState<Set<string>>(new Set());
  const didAnimate = useRef(false);

  const prevNames = useMemo(
    () => new Set((previousState?.characters ?? []).map((c) => c.name)),
    [previousState],
  );
  const currNames = useMemo(() => new Set(state.characters.map((c) => c.name)), [state]);

  const removed = useMemo(
    () => (previousState?.characters ?? []).filter((c) => !currNames.has(c.name)),
    [previousState, currNames],
  );
  const added = useMemo(
    () => state.characters.filter((c) => !prevNames.has(c.name)),
    [state, prevNames],
  );

  // Nodes rendered during the transition = current characters + any just-removed
  // ones (still visible mid-exit). Once the exit animation finishes, `removed`
  // drops out on its own since we stop including it below.
  const [showRemoved, setShowRemoved] = useState(true);

  useEffect(() => {
    if (didAnimate.current || !previousState) return;
    didAnimate.current = true;
    if (added.length > 0) setEntering(new Set(added.map((c) => c.name)));
    if (removed.length > 0) setExiting(new Set(removed.map((c) => c.name)));
    const enterTimer = setTimeout(() => setEntering(new Set()), ENTER_MS);
    const exitTimer = setTimeout(() => setShowRemoved(false), EXIT_MS);
    return () => {
      clearTimeout(enterTimer);
      clearTimeout(exitTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayed: Array<StoryStateCharacter & { _exiting?: boolean }> = [
    ...state.characters,
    ...(showRemoved ? removed.map((c) => ({ ...c, _exiting: true })) : []),
  ];

  const n = Math.max(displayed.length, 1);
  const R = 62;
  const CX = 90;
  const CY = 78;

  return (
    <div>
      <div className="rounded-lg border border-black/[0.08] bg-[#fbfbf9]">
        <svg viewBox="0 0 180 156" width="100%" height="140">
          {displayed.map((c, i) => {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = CX + R * Math.cos(angle);
            const y = CY + R * Math.sin(angle) * 0.72;
            return (
              <line
                key={`edge-${c.name}`}
                x1={CX}
                y1={CY}
                x2={x}
                y2={y}
                stroke="#d8dade"
                strokeWidth="1"
                style={{
                  transition: `opacity ${EXIT_MS}ms ease`,
                  opacity: exiting.has(c.name) ? 0 : 1,
                }}
              />
            );
          })}
          <circle cx={CX} cy={CY} r="4" fill="#9aa0a8" />
          {displayed.map((c, i) => {
            const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
            const x = CX + R * Math.cos(angle);
            const y = CY + R * Math.sin(angle) * 0.72;
            const isExiting = exiting.has(c.name);
            const isEntering = entering.has(c.name);
            return (
              <g
                key={c.name}
                style={{
                  transformOrigin: `${x}px ${y}px`,
                  transition: `opacity ${isExiting ? EXIT_MS : ENTER_MS}ms ease, transform ${isExiting ? EXIT_MS : ENTER_MS}ms ease`,
                  opacity: isExiting ? 0 : isEntering ? 0 : 1,
                  transform: isExiting
                    ? "scale(0.15) rotate(25deg)"
                    : isEntering
                      ? "scale(0.2)"
                      : "scale(1)",
                }}
              >
                <circle cx={x} cy={y} r="8" fill={COLOR[classify(c.status)]} />
                <text x={x} y={y - 12} fontSize="9" textAnchor="middle" fontFamily="Georgia, serif" fill="#14181c">
                  {c.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-[11px] text-black/60">
        <span>
          <i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: COLOR.alive }} /> alive / free
        </span>
        <span>
          <i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: COLOR.gone }} /> gone / captured
        </span>
        <span>
          <i className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: COLOR.unresolved }} /> unresolved
        </span>
      </div>

      {state.unresolvedThreads.length > 0 && (
        <div className="mt-3 border-t border-black/[0.08] pt-3">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-black/40">Unresolved</p>
          <ul className="space-y-1 text-[11.5px] text-black/60">
            {state.unresolvedThreads.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
