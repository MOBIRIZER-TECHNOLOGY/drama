/** Design tokens shared by web and mobile. Dark-first: the player and feed live on near-black. */
export const colors = {
  ground: "#141013",
  surface: "#1F181B",
  surface2: "#2A2125",
  ink: "#F3ECEE",
  ink2: "#D9CDD1",
  muted: "#A99BA0",
  line: "#332A2E",
  accent: "#F05A72",
  accentInk: "#1A0D11",
  gold: "#E0B44A",
  success: "#8ED1AE",
  warning: "#E9A968",
  danger: "#F09AA6",
} as const;

export const radii = { sm: 6, md: 12, lg: 18, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const type = {
  display: "Bricolage Grotesque",
  body: "IBM Plex Sans",
  mono: "IBM Plex Mono",
} as const;
