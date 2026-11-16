import { useEffect } from "react";

/** Фиксированный слой живого фона: размытые пятна, редкое мерцание, зерно. */
const SPARKS = [
  { left: "12%", top: "22%", t: "11s", delay: "-2s" },
  { left: "78%", top: "14%", t: "13s", delay: "-7s" },
  { left: "64%", top: "58%", t: "17s", delay: "-4s" },
  { left: "28%", top: "72%", t: "15s", delay: "-11s" },
  { left: "90%", top: "40%", t: "19s", delay: "-9s" },
  { left: "44%", top: "8%", t: "21s", delay: "-15s" },
];

export function Ambient() {
  useEffect(() => {
    const onVis = () => {
      document.documentElement.dataset.hidden = document.hidden ? "true" : "false";
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return (
    <div className="ambient" aria-hidden="true">
      <div className="ambient__blob ambient__blob--a" />
      <div className="ambient__blob ambient__blob--b" />
      <div className="ambient__blob ambient__blob--c" />
      {SPARKS.map((s, i) => (
        <span
          key={i}
          className="ambient__spark"
          style={{ left: s.left, top: s.top, animationDelay: s.delay, ["--t" as string]: s.t }}
        />
      ))}
      <div className="ambient__grain" />
      <div className="ambient__vignette" />
    </div>
  );
}

/** Страница сообщает интенсивность фона: на главной заметнее, в рабочих разделах тише. */
export function useAmbient(level: "high" | "low") {
  useEffect(() => {
    document.body.dataset.ambient = level;
  }, [level]);
}
