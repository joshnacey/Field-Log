/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        rust: "#B5482A",
        rustdk: "#9A3D22",
        ink: "#2A2620",
        paper: "#F1EADA",
        olive: "#3D4128",
        olivedk: "#2A2D1B",
        line: "#D9CFB5",
        muted: "#6B6449",
        faint: "#9C9678",
        card: "#FBF7EC",
        sand: "#E8DFC8",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(42,38,32,0.05), 0 3px 10px rgba(42,38,32,0.07)",
        lifted: "0 6px 16px rgba(42,38,32,0.10), 0 16px 44px rgba(42,38,32,0.18)",
      },
    },
  },
  plugins: [],
};
