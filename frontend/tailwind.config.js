/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        surface: "var(--surface)",
        "surface-hover": "var(--surface-hover)",
        "surface-elevated": "var(--surface-elevated)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        brand: "var(--brand)",
        "brand-hover": "var(--brand-hover)",
        "brand-foreground": "var(--brand-foreground)",
        link: "var(--link)",
        "link-hover": "var(--link-hover)",
        sutra: "var(--sutra)",
        "sutra-hover": "var(--sutra-hover)",
      },
      borderRadius: {
        xl: "var(--radius-xl)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
