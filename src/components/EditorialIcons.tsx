interface IconProps {
  className?: string;
}

export function MedalIcon({ className = "" }: IconProps) {
  return (
    <svg className={`medal-icon ${className}`} viewBox="0 0 64 64" aria-hidden="true">
      <circle className="medal-icon__echo" cx="32" cy="25" r="17.5" fill="none" />
      <circle cx="32" cy="25" r="13" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <path
        d="m24.5 36.5-2 18 9.5-6 9.5 6-2-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m32 16.5 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8 2.5-5Z"
        className="medal-icon__star"
        fill="currentColor"
      />
    </svg>
  );
}

export function DiaryTraceIcon({ className = "" }: IconProps) {
  return (
    <svg className={`diary-trace-icon ${className}`} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M8.5 15.5c9.2-2.5 17-1 23.5 4.5v34c-6.5-5.5-14.3-7-23.5-4.5v-34Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M55.5 15.5C46.3 13 38.5 14.5 32 20v34c6.5-5.5 14.3-7 23.5-4.5v-34Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M32 20v34" stroke="currentColor" strokeWidth="2.2" />
      <path
        className="diary-trace-icon__leaf"
        d="M45.5 24c-6.4 2.4-9.7 7.1-10 14 6.3-2.1 9.7-6.8 10-14Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkPulseIcon({ className = "" }: IconProps) {
  return (
    <svg className={`work-pulse-icon ${className}`} viewBox="0 0 92 32" aria-hidden="true">
      <path className="work-pulse-icon__baseline" d="M2 17h88" />
      <path className="work-pulse-icon__wave" d="M2 17h22l5-8 8 18 8-14 7 4h38" />
      <circle className="work-pulse-icon__node" cx="90" cy="17" r="3.4" />
    </svg>
  );
}
