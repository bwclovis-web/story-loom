"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { WRITING_GOALS } from "@/ui/labels";

const MINUTES = [15, 25, 45] as const;

/** A local countdown. It does not write a revision or a goal. */
export function WritingSprint() {
  const [minutes, setMinutes] = useState<(typeof MINUTES)[number]>(25);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          setRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const choose = (next: (typeof MINUTES)[number]) => {
    setMinutes(next);
    setRunning(false);
    setRemaining(next * 60);
  };

  const shown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;

  return (
    <div className="writing-sprint" role="group" aria-label={WRITING_GOALS.sprint}>
      {MINUTES.map((value) => (
        <Button key={value} type="button" size="sm" variant={minutes === value ? "primary" : "secondary"} onClick={() => choose(value)}>
          {WRITING_GOALS.sprintMinutes(value)}
        </Button>
      ))}
      <span className="writing-sprint-time" aria-live="polite">
        {shown}
      </span>
      <Button type="button" size="sm" variant="secondary" onClick={() => setRunning((current) => !current)}>
        {running ? WRITING_GOALS.sprintPause : WRITING_GOALS.sprintStart}
      </Button>
      <Button type="button" size="sm" variant="secondary" onClick={() => choose(minutes)}>
        {WRITING_GOALS.sprintReset}
      </Button>
    </div>
  );
}
