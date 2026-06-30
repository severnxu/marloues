import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

const hslVar = (name: string) => `hsl(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./renderer/index.html", "./renderer/src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: hslVar("--tw-border"),
        input: hslVar("--tw-input"),
        ring: hslVar("--tw-ring"),
        background: hslVar("--tw-background"),
        foreground: hslVar("--tw-foreground"),
        primary: {
          DEFAULT: hslVar("--tw-primary"),
          foreground: hslVar("--tw-primary-foreground"),
          glow: hslVar("--tw-primary-glow"),
        },
        secondary: {
          DEFAULT: hslVar("--tw-secondary"),
          foreground: hslVar("--tw-secondary-foreground"),
        },
        destructive: {
          DEFAULT: hslVar("--tw-destructive"),
          foreground: hslVar("--tw-destructive-foreground"),
        },
        muted: {
          DEFAULT: hslVar("--tw-muted"),
          foreground: hslVar("--tw-muted-foreground"),
        },
        accent: {
          DEFAULT: hslVar("--tw-accent"),
          foreground: hslVar("--tw-accent-foreground"),
          glow: hslVar("--tw-accent-glow"),
        },
        popover: {
          DEFAULT: hslVar("--tw-popover"),
          foreground: hslVar("--tw-popover-foreground"),
        },
        card: {
          DEFAULT: hslVar("--tw-card"),
          foreground: hslVar("--tw-card-foreground"),
        },
        sidebar: {
          DEFAULT: hslVar("--tw-sidebar"),
          foreground: hslVar("--tw-sidebar-foreground"),
          border: hslVar("--tw-sidebar-border"),
          hover: hslVar("--tw-sidebar-hover"),
          active: hslVar("--tw-sidebar-active"),
        },
        titlebar: {
          DEFAULT: hslVar("--tw-titlebar"),
          foreground: hslVar("--tw-titlebar-foreground"),
        },
        success: {
          DEFAULT: hslVar("--tw-success"),
          foreground: hslVar("--tw-success-foreground"),
        },
        warning: {
          DEFAULT: hslVar("--tw-warning"),
          foreground: hslVar("--tw-warning-foreground"),
        },
        shell: hslVar("--tw-shell"),
        surface: hslVar("--tw-surface"),
        panel: hslVar("--tw-panel"),
        line: {
          DEFAULT: hslVar("--tw-line"),
          strong: hslVar("--tw-line-strong"),
        },
        "muted-soft": hslVar("--tw-muted-soft"),
        text: {
          strong: hslVar("--tw-text-strong"),
          normal: hslVar("--tw-text-normal"),
          muted: hslVar("--tw-text-muted"),
          subtle: hslVar("--tw-text-subtle"),
        },
        danger: {
          DEFAULT: hslVar("--tw-danger"),
          soft: hslVar("--tw-danger-soft"),
        },
        "accent-soft": hslVar("--tw-accent-soft"),
        "accent-strong": hslVar("--tw-accent-strong"),
        "accent-foreground": hslVar("--tw-accent-foreground"),
        "text-secondary": hslVar("--tw-text-muted"),
        "text-muted": hslVar("--tw-text-muted"),
        "text-subtle": hslVar("--tw-text-subtle"),
        "text-normal": hslVar("--tw-text-normal"),
        "text-strong": hslVar("--tw-text-strong"),
        "line-strong": hslVar("--tw-line-strong"),
        "danger-soft": hslVar("--tw-danger-soft"),
        "muted-foreground": hslVar("--tw-muted-foreground"),
        "primary-foreground": hslVar("--tw-primary-foreground"),
        "secondary-foreground": hslVar("--tw-secondary-foreground"),
        "destructive-foreground": hslVar("--tw-destructive-foreground"),
        "success-foreground": hslVar("--tw-success-foreground"),
        "warning-foreground": hslVar("--tw-warning-foreground"),
        "popover-foreground": hslVar("--tw-popover-foreground"),
        "card-foreground": hslVar("--tw-card-foreground"),
        "sidebar-foreground": hslVar("--tw-sidebar-foreground"),
        "titlebar-foreground": hslVar("--tw-titlebar-foreground"),
        "accent-glow": hslVar("--tw-accent-glow"),
        "primary-glow": hslVar("--tw-primary-glow"),
        "sidebar-border": hslVar("--tw-sidebar-border"),
        "sidebar-hover": hslVar("--tw-sidebar-hover"),
        "sidebar-active": hslVar("--tw-sidebar-active"),
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        glow: "var(--shadow-glow)",
        card: "var(--shadow-card)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { opacity: "0.3", transform: "scale(0.8)" },
          "30%": { opacity: "1", transform: "scale(1)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "var(--shadow-glow)" },
          "50%": { boxShadow: "var(--glow-primary)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.25s ease-out",
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "typing-dot-1": "typing-dot 1.4s ease-in-out infinite",
        "typing-dot-2": "typing-dot 1.4s ease-in-out 0.2s infinite",
        "typing-dot-3": "typing-dot 1.4s ease-in-out 0.4s infinite",
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
};

export default config;
