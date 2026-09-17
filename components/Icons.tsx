import React from "react";
import { useSpring, animated } from "@react-spring/web";

interface IconProps {
  className?: string;
}

export const AuraLogo: React.FC<IconProps> = ({ className }) => (
  <svg
    viewBox="0 0 512 512"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <defs>
      <linearGradient id="auraGrad" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#8b5cf6" />
        <stop offset="0.5" stopColor="#ec4899" />
        <stop offset="1" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <rect
      width="512"
      height="512"
      rx="128"
      fill="currentColor"
      className="text-black dark:text-black"
    />
    {/* Left Bar */}
    <rect
      x="146"
      y="190"
      width="60"
      height="132"
      rx="30"
      fill="url(#auraGrad)"
    />
    {/* Center Bar (Taller) */}
    <rect
      x="226"
      y="120"
      width="60"
      height="272"
      rx="30"
      fill="url(#auraGrad)"
    />
    {/* Right Bar */}
    <rect
      x="306"
      y="210"
      width="60"
      height="96"
      rx="30"
      fill="url(#auraGrad)"
    />
  </svg>
);

// Playback actions share a 24px grid, rounded joins and a lighter 1.8px stroke.
export const LoopIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 10V9a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 14v1a3 3 0 0 1-3 3H4m3 3-3-3 3-3" />
  </svg>
);

export const LoopOneIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 10V9a3 3 0 0 1 3-3h13m-3-3 3 3-3 3M20 14v1a3 3 0 0 1-3 3H4m3 3-3-3 3-3" />
    <path d="m10.5 11 1.5-1v4.5" strokeWidth="1.6" />
  </svg>
);

export const ShuffleIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 6h1.5c4 0 9 12 13 12H21m-3-3 3 3-3 3M4 18h1.5c1.6 0 3.4-2 5.2-4.4M13.3 10.4C15.1 8 16.9 6 18.5 6H21m-3-3 3 3-3 3" />
  </svg>
);

export const VolumeMuteIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path
      d="M13,4.1 L8.3,8.5 L5,8.5 C4.4,8.5 4,8.9 4,9.5 L4,14.5 C4,15.1 4.4,15.5 5,15.5 L8.3,15.5 L13,19.9 C13.5,20.4 14.5,20 14.5,19.2 L14.5,4.8 C14.5,4 13.5,3.6 13,4.1 Z"
      fill="currentColor"
    />
  </svg>
);

export const VolumeLowIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path
      d="M13,4.1 L8.3,8.5 L5,8.5 C4.4,8.5 4,8.9 4,9.5 L4,14.5 C4,15.1 4.4,15.5 5,15.5 L8.3,15.5 L13,19.9 C13.5,20.4 14.5,20 14.5,19.2 L14.5,4.8 C14.5,4 13.5,3.6 13,4.1 Z"
      fill="currentColor"
    />
    <path
      d="M 16.5 8.5 C 18 10 18 14 16.5 15.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

export const VolumeHighIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 28 24" className={className}>
    <path d="M10.6 4.4 6.3 8H3.5C2.6 8 2 8.6 2 9.5v5c0 .9.6 1.5 1.5 1.5h2.8l4.3 3.6c.8.7 1.9.2 1.9-.9V5.3c0-1.1-1.1-1.6-1.9-.9Z" fill="currentColor" />
    <path d="M16 9a5.5 5.5 0 0 1 0 6M19.5 6.7a9.5 9.5 0 0 1 0 10.6M23 4.5a13.5 13.5 0 0 1 0 15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

export const VolumeMuteFilledIcon = VolumeMuteIcon;
export const VolumeLowFilledIcon = VolumeLowIcon;
export const VolumeHighFilledIcon = VolumeHighIcon;


// Rounded transport silhouettes share a consistent optical center.
export const PlayIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 40 40" fill="currentColor" className={className}>
    <path d="M9 5.4C9 3.3 11 2.4 12.8 3.5L35 17.2c2.2 1.3 2.2 4.3 0 5.6L12.8 36.5C11 37.6 9 36.7 9 34.6Z" />
  </svg>
);

export const PauseIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 40 40" fill="currentColor" className={className}>
    <rect x="6" y="3" width="12" height="34" rx="3.2" />
    <rect x="22" y="3" width="12" height="34" rx="3.2" />
  </svg>
);

const skip = "M2 12.1 16.4 3.4c1.6-1 3.1-.2 3.1 1.6v17c0 1.8-1.5 2.6-3.1 1.6L2 14.9c-1.2-.7-1.2-2.1 0-2.8Z";

export const PrevIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 40 27" fill="currentColor" className={className}>
    <path d={skip} />
    <path d={skip} transform="translate(18.5 0)" />
  </svg>
);

export const NextIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 40 27" fill="currentColor" className={className}>
    <g transform="translate(40 0) scale(-1 1)">
      <path d={skip} />
      <path d={skip} transform="translate(18.5 0)" />
    </g>
  </svg>
);

export const LikeIcon: React.FC<IconProps & { filled?: boolean }> = ({
  className,
  filled,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

export const QueueIcon: React.FC<IconProps> = ({ className }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 5.5h16M4 11.5h16M4 17.5h7" />
    <path d="m16 15 4.5 3-4.5 3z" fill="currentColor" strokeWidth="1.3" />
  </svg>
);

export const GripIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <circle cx="9" cy="6" r="1.5" />
    <circle cx="15" cy="6" r="1.5" />
    <circle cx="9" cy="12" r="1.5" />
    <circle cx="15" cy="12" r="1.5" />
    <circle cx="9" cy="18" r="1.5" />
    <circle cx="15" cy="18" r="1.5" />
  </svg>
);

export const PlusIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 20 20"
    fill="currentColor"
    className={className}
  >
    <path
      fillRule="evenodd"
      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
      clipRule="evenodd"
    />
  </svg>
);

export const LinkIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M19.902 4.098a3.75 3.75 0 00-5.304 0l-4.5 4.5a3.75 3.75 0 001.035 6.037.75.75 0 01-.646 1.353 5.25 5.25 0 01-1.449-8.45l4.5-4.5a5.25 5.25 0 117.424 7.424l-1.757 1.757a.75.75 0 11-1.06-1.06l1.757-1.757a3.75 3.75 0 000-5.304zm-7.389 4.267a.75.75 0 011-.353 5.25 5.25 0 011.449 8.45l-4.5 4.5a5.25 5.25 0 11-7.424-7.424l1.757-1.757a.75.75 0 111.06 1.06l-1.757 1.757a3.75 3.75 0 105.304 5.304l4.5-4.5a3.75 3.75 0 00-1.035-6.037.75.75 0 01-.354-1z"
    />
  </svg>
);

export const KeyboardIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M20 5H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const LocalMusicIcon: React.FC<IconProps> = ({
  className = "",
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M10.5 21.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v3" />
    <circle cx="16" cy="18" r="2" />
    <path d="M18 18V12h4v3" />
  </svg>
);

export const TrashIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const SelectAllIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  </svg>
);

export const InfoIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const FullscreenIcon: React.FC<
  IconProps & { isFullscreen?: boolean }
> = ({ className, isFullscreen }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {isFullscreen ? (
      <>
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </>
    ) : (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        <path d="M16 21h3a2 2 0 0 1 2-2v-3" />
      </>
    )}
  </svg>
);
