export function DrawPieIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`draw-pie-icon ${className}`}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        className="draw-pie-icon__crumb draw-pie-icon__crumb--one"
        d="M13 18.5 10.5 16"
      />
      <path
        className="draw-pie-icon__crumb draw-pie-icon__crumb--two"
        d="m17.5 13-.2-3.6"
      />
      <path
        className="draw-pie-icon__sketch"
        d="M36.2 27.8C30.5 22 20.5 23 16 29.5c-4.4 6.5-.5 15 8 18 8.5 3 19-.5 23-7.5s-2-12.5-10.8-12.2"
        pathLength="1"
      />
      <g className="draw-pie-icon__finished">
        <path
          className="draw-pie-icon__pie"
          d="M36.2 27.8C30.5 22 20.5 23 16 29.5c-4.4 6.5-.5 15 8 18 8.5 3 19-.5 23-7.5s-2-12.5-10.8-12.2"
        />
        <path
          className="draw-pie-icon__rim"
          d="M17.8 41.2c7.4 5.1 19.7 5.3 27.3-.4"
        />
        <ellipse className="draw-pie-icon__toast draw-pie-icon__toast--one" cx="22.4" cy="32.1" rx="1.5" ry="1" />
        <ellipse className="draw-pie-icon__toast draw-pie-icon__toast--two" cx="31.1" cy="29.5" rx="1.1" ry="0.8" />
        <ellipse className="draw-pie-icon__toast draw-pie-icon__toast--three" cx="39.1" cy="33.2" rx="1.8" ry="1.1" />
        <ellipse className="draw-pie-icon__toast draw-pie-icon__toast--four" cx="27.2" cy="39.2" rx="1.7" ry="1.1" />
        <ellipse className="draw-pie-icon__toast draw-pie-icon__toast--five" cx="36.7" cy="40.3" rx="1.1" ry="0.8" />
        <path className="draw-pie-icon__sesame" d="m25.2 35.2 1.5-.5m6.2-.6 1.3.5m7.2 2.4 1.3-.3m-20.6 3.1 1.3.4m8.1 3 1.4-.4" />
      </g>
      <g className="draw-pie-icon__pencil">
        <path
          className="draw-pie-icon__pencil-body"
          d="m38.5 18.8 11.8-11.7 6.6 6.6-11.8 11.7-8.9 2.4Z"
        />
        <path className="draw-pie-icon__pencil-band" d="m47.6 9.8 6.6 6.6" />
        <path className="draw-pie-icon__pencil-tip" d="m36.2 27.8 2.3-9 6.6 6.6Z" />
      </g>
    </svg>
  );
}
