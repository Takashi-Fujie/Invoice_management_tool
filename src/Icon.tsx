import React from "react";
const paths = {
  month: "M4 4h16v16H4zM4 9h16M9 9v11",
  annual: "M5 20V12m7 8V4m7 16V8",
  left: "m14 6-6 6 6 6",
  right: "m10 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  edit: "m15 4 5 5-10 10-6 1 1-6ZM13 6l5 5",
  company: "M4 21V4h11v17M15 10h5v11M8 8h3M8 12h3M8 16h3M2 21h20",
};
export function Icon({
  name,
  size = 17,
}: {
  name: keyof typeof paths;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
