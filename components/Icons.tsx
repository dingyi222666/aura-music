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

export const LoopIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    className={className}
  >
    <path
      d="M 3 13 V 8.5 C 3 6.57 4.57 5 6.5 5 H 17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M 15.5 1.5 L 21 5 L 15.5 8.5 Z"
      fill="currentColor"
    />
    <path
      d="M 21 11 V 15.5 C 21 17.43 19.43 19 17.5 19 H 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M 8.5 15.5 L 3 19 L 8.5 22.5 Z"
      fill="currentColor"
    />
  </svg>
);

export const LoopOneIcon = LoopIcon;

export const ShuffleIcon: React.FC<IconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M 4 5.5 h 2.5 c 1.5 0, 2.8 1.1, 4 3 L 14 15.5 c 1.2 1.9, 2.5 3, 4 3 h 2.5" />
    <path d="M 16.5 14.5 L 20.5 18.5 L 16.5 22.5" />
    <path d="M 4 18.5 h 2.5 c 1.5 0, 2.8 -1.1, 4 -3 L 14 8.5 c 1.2 -1.9, 2.5 -3, 4 -3 h 2.5" />
    <path d="M 16.5 1.5 L 20.5 5.5 L 16.5 9.5" />
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
    <path
      d="M 19.5 5.5 C 22.5 8.5 22.5 15.5 19.5 18.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

export const VolumeMuteFilledIcon = VolumeMuteIcon;
export const VolumeLowFilledIcon = VolumeLowIcon;
export const VolumeHighFilledIcon = VolumeHighIcon;





const playPath = "M7.5776,36C5.619,36 4.1567,34.6943 4,32.5008L4,5.4992C4.1567,3.3057 5.619,2 7.5776,2C8.5438,2 9.2227,2.2873 10.3195,2.8618L35.1536,15.5269C36.9293,16.4409 38,17.3287 38,19C38,20.6713 36.9293,21.5591 35.1536,22.4731L10.3195,35.1382C9.2227,35.7127 8.5438,36 7.5776,36Z";

export const PlayIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 38 38" fill="currentColor" className={className}>
    <path d={playPath} />
  </svg>
);

export const PauseIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="0 0 38 38" fill="currentColor" className={className}>
    <path d="M8.7384,36C6.3594,36 5,34.5857 5,32.4261L5,5.593C5,3.4143 6.3594,2 8.7384,2L12.911,2C15.2711,2 16.6305,3.4143 16.6305,5.593L16.6305,32.4261C16.6305,34.6048 15.2711,36 12.911,36L8.7384,36ZM25.089,36C22.7289,36 21.3695,34.6048 21.3695,32.4261L21.3695,5.593C21.3695,3.4143 22.7289,2 25.089,2L29.2616,2C31.6406,2 33,3.4143 33,5.593L33,32.4261C33,34.5857 31.6406,36 29.2616,36L25.089,36Z" />
  </svg>
);

export const PrevIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="24.4 43.7 81.6 46.6" fill="currentColor" className={className}>
    <path d="M72 60.0717C68.062 62.3453 66.0931 63.4821 65.4323 64.9662C64.8559 66.2608 64.8559 67.7391 65.4323 69.0336C66.0931 70.5177 68.062 71.6545 72 73.9281L93 86.0525C96.938 88.326 98.9069 89.4628 100.523 89.293C101.932 89.1449 103.212 88.4057 104.045 87.2593C105 85.945 105 83.6714 105 79.1243V54.8755C105 50.3284 105 48.0548 104.045 46.7405C103.212 45.5941 101.932 44.8549 100.523 44.7068C98.9069 44.537 96.938 45.6738 93 47.9473L72 60.0717Z" />
    <path d="M32 60.0717C28.062 62.3453 26.0931 63.4821 25.4323 64.9662C24.8559 66.2608 24.8559 67.7391 25.4323 69.0336C26.0931 70.5177 28.062 71.6545 32 73.9281L53 86.0525C56.938 88.326 58.9069 89.4628 60.5226 89.293C61.9319 89.1449 63.2122 88.4057 64.0451 87.2593C65 85.945 65 83.6714 65 79.1243V54.8755C65 50.3284 65 48.0548 64.0451 46.7405C63.2122 45.5941 61.9319 44.8549 60.5226 44.7068C58.9069 44.537 56.938 45.6738 53 47.9473L32 60.0717Z" />
  </svg>
);

export const NextIcon: React.FC<IconProps> = ({ className }) => (
  <svg viewBox="28 43.7 81.6 46.6" fill="currentColor" className={className}>
    <path d="M62 60.0717C65.938 62.3453 67.9069 63.4821 68.5677 64.9662C69.1441 66.2608 69.1441 67.7391 68.5677 69.0336C67.9069 70.5177 65.938 71.6545 62 73.9281L41 86.0525C37.062 88.326 35.0931 89.4628 33.4774 89.293C32.0681 89.1449 30.7878 88.4057 29.9549 87.2593C29 85.945 29 83.6714 29 79.1243V54.8755C29 50.3284 29 48.0548 29.9549 46.7405C30.7878 45.5941 32.0681 44.8549 33.4774 44.7068C35.0931 44.537 37.062 45.6738 41 47.9473L62 60.0717Z" />
    <path d="M102 60.0717C105.938 62.3453 107.907 63.4821 108.568 64.9662C109.144 66.2608 109.144 67.7391 108.568 69.0336C107.907 70.5177 105.938 71.6545 102 73.9281L81 86.0525C77.062 88.326 75.0931 89.4628 73.4774 89.293C72.0681 89.1449 70.7878 88.4057 69.9549 87.2593C69 85.945 69 83.6714 69 79.1243V54.8755C69 50.3284 69 48.0548 69.9549 46.7405C70.7878 45.5941 72.0681 44.8549 73.4774 44.7068C75.0931 44.537 77.062 45.6738 81 47.9473L102 60.0717Z" />
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
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="9" y1="12" x2="20" y2="12" />
    <line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="4.5" cy="6" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="4.5" cy="18" r="1.25" fill="currentColor" stroke="none" />
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
