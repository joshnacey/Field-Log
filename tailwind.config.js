/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        rust: "#B5482A",
        rustlt: "#D9663F",
        rustdk: "#9A3D22",
        ink: "#ECE7D8",
        paper: "#F1EADA",
        bg: "#12140D",
        panel: "#171A0F",
        olive: "#A8B07A",
        olivedk: "#2A2D1B",
        line: "rgba(255,255,255,0.09)",
        muted: "#9E9A82",
        faint: "#82806A",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.35)",
        lifted: "0 12px 32px rgba(0,0,0,0.5), 0 24px 64px rgba(0,0,0,0.55)",
        glow: "0 0 22px rgba(181,72,42,0.35)",
      },
    },
  },
  plugins: [],
};
