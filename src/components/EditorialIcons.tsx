interface IconProps {
  className?: string;
}

export function BrandMarkIcon({ className = "" }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label="VibeKarma"
    >
      <rect x="2.5" y="2.5" width="59" height="59" rx="15" fill="#173d33" />
      <rect x="6.5" y="6.5" width="51" height="51" rx="11" fill="none" stroke="#b78a34" />
      <path
        d="M14 20.5c7.6-2.1 13.7-.8 18 3.9v24.3c-4.5-4.2-10.5-5.4-18-3.4V20.5Z"
        fill="#f7f0df"
        stroke="#d8c8a2"
        strokeLinejoin="round"
      />
      <path
        d="M50 20.5c-7.6-2.1-13.7-.8-18 3.9v24.3c4.5-4.2 10.5-5.4 18-3.4V20.5Z"
        fill="#f7f0df"
        stroke="#d8c8a2"
        strokeLinejoin="round"
      />
      <path d="M32 25v22" stroke="#b78a34" strokeWidth="1.4" />
      <path
        d="M43.5 12.5c-8 4.2-11.2 10.7-9.7 19.4 7.2-3 11.2-9.1 12-18.2l-2.3-1.2Z"
        fill="#d6ad50"
        stroke="#8b651d"
        strokeLinejoin="round"
      />
      <path d="M43.8 14.2 34 31.8" stroke="#805c1d" strokeLinecap="round" />
    </svg>
  );
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
