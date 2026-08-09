/**
 * @file Brand logos and Material-style file icons used across the docs site.
 * Pure SVG components — safe in both server and client components.
 */

interface IconProps {
  size?: number;
  className?: string;
}

/**
 * Renders the vscode logo component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The official blue Visual Studio Code mark.
 */
export function VSCodeLogo({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#0098FF"
        d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
      />
    </svg>
  );
}

/**
 * Renders the npm logo component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The official red npm mark.
 */
export function NpmLogo({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#CB3837"
        d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"
      />
    </svg>
  );
}

/**
 * Renders the terminal icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The dark terminal and command-prompt glyph.
 */
export function TerminalIcon({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="1.5" y="3.5" width="21" height="17" rx="3" fill="#1f2328" />
      <path
        d="M6 9l3 3-3 3"
        fill="none"
        stroke="#61c554"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 15.5H17"
        fill="none"
        stroke="#c9d1d9"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Renders the book icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The monochrome documentation-book glyph.
 */
export function BookIcon({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#1f2328"
        d="M6 2.5A2.5 2.5 0 0 0 3.5 5v14A2.5 2.5 0 0 0 6 21.5h13a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H6a1 1 0 0 1 0 2h12v12.5H6a2.5 2.5 0 0 0-.5.05V5A.5.5 0 0 1 6 4.5z"
      />
      <path fill="#1f2328" d="M6 18.5h12v2H6a1 1 0 0 1 0-2z" />
    </svg>
  );
}

/**
 * Renders the git hub logo component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The official monochrome GitHub mark.
 */
export function GitHubLogo({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#181717"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

/**
 * Renders the cursor logo component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The shaded isometric Cursor mark.
 */
export function CursorLogo({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#8a8a8a" d="M12 2 21 7 12 12 3 7z" />
      <path fill="#111111" d="M3 7 12 12v10L3 17z" />
      <path fill="#454545" d="M21 7 12 12v10l9-5z" />
    </svg>
  );
}

/**
 * Renders the file code icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The declarative source-file feature icon.
 */
export function FileCodeIcon({ size = 22, className }: IconProps) {
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
      className={className}
      aria-hidden
    >
      <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M13 3v5h5" />
      <path d="M9.5 12.5 8 14l1.5 1.5M14.5 12.5 16 14l-1.5 1.5" />
    </svg>
  );
}

/**
 * Renders the command icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The single-command terminal feature icon.
 */
export function CommandIcon({ size = 22, className }: IconProps) {
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
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 9.5 3 2.5-3 2.5M13 15h4" />
    </svg>
  );
}

/**
 * Renders the sparkle icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The plain-language authoring sparkle icon.
 */
export function SparkleIcon({ size = 22, className }: IconProps) {
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
      className={className}
      aria-hidden
    >
      <path d="M12 3c.5 3.8 1.7 5 5.5 5.5C13.7 9 12.5 10.2 12 14c-.5-3.8-1.7-5-5.5-5.5C10.3 8 11.5 6.8 12 3Z" />
      <path d="M18.5 14c.2 1.6.7 2.1 2.3 2.3-1.6.2-2.1.7-2.3 2.3-.2-1.6-.7-2.1-2.3-2.3 1.6-.2 2.1-.7 2.3-2.3Z" />
    </svg>
  );
}

/**
 * Renders the nt file icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The purple Material-style icon for an `.nt` source file.
 */
export function NtFileIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#B39DDB"
        d="M13.5 2H6.5A1.5 1.5 0 0 0 5 3.5v17A1.5 1.5 0 0 0 6.5 22h11a1.5 1.5 0 0 0 1.5-1.5V7.5z"
      />
      <path fill="#7E57C2" d="M13.5 2 19 7.5h-4.5A1 1 0 0 1 13.5 6.5z" />
      <path fill="#4527A0" d="M8 12.2h8v1.3H8zm0 2.7h8v1.3H8zm0 2.7h5.5v1.3H8z" />
    </svg>
  );
}

/**
 * Renders the folder icon component from its documented props.
 * @param size Rendered square size in CSS pixels.
 * @param className Optional styling hook supplied by the caller.
 * @returns The blue Material-style open-folder icon.
 */
export function FolderIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#42A5F5"
        d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z"
      />
      <path fill="#64B5F6" d="M2 9h20v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" />
    </svg>
  );
}
